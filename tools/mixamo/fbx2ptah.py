#!/usr/bin/env python3
"""fbx2ptah.py — convert a Mixamo character + animation pack to one skinned glTF.

    python3 tools/mixamo/fbx2ptah.py <character.fbx> <anim1.fbx> [anim2.fbx ...] -o mannequin.glb [--js mannequin.glb.js]

Reads Kaydara binary FBX (7.1 to 7.7) directly: no FBX SDK, no Blender. It
handles what Mixamo exports and nothing more: one skinned mesh, LimbNode
bones with Lcl Translation/Rotation/Scaling and PreRotation, Cluster deformers,
and baked AnimationCurves on Lcl Rotation / Lcl Translation. Textures are
dropped on purpose; each material becomes a flat colour, which is what a
blockout mannequin should look like. Locomotion clips get their horizontal
root motion removed so the controller can drive position.

Output is glTF 2.0 in a .glb container: POSITION, NORMAL, JOINTS_0 (u8),
WEIGHTS_0 (f32), u16/u32 indices, one skin, one animation per input file
(named after the file). Optionally also a JS module exporting the GLB as
base64 so the app can import it under a strict CSP with no fetch.
"""
import argparse, json, math, os, struct, sys, zlib
import numpy as np

FBX_TIME = 46186158000.0          # FBX ticks per second

# --------------------------------------------------------------------------- binary FBX
class Node:
    __slots__ = ('name', 'props', 'children')
    def __init__(self, name, props, children): self.name, self.props, self.children = name, props, children
    def child(self, name):
        for c in self.children:
            if c.name == name: return c
        return None
    def all(self, name): return [c for c in self.children if c.name == name]

ARRAY_DTYPES = {b'f': '<f4', b'd': '<f8', b'l': '<i8', b'i': '<i4', b'b': '<u1'}
SCALAR = {b'Y': ('<h', 2), b'C': ('<B', 1), b'I': ('<i', 4), b'F': ('<f', 4), b'D': ('<d', 8), b'L': ('<q', 8)}

def read_prop(buf, pos):
    t = buf[pos:pos + 1]; pos += 1
    if t in SCALAR:
        fmt, n = SCALAR[t]
        return struct.unpack_from(fmt, buf, pos)[0], pos + n
    if t in ARRAY_DTYPES:
        count, enc, clen = struct.unpack_from('<III', buf, pos); pos += 12
        raw = buf[pos:pos + clen]; pos += clen
        if enc == 1: raw = zlib.decompress(raw)
        return np.frombuffer(raw, dtype=ARRAY_DTYPES[t], count=count).copy(), pos
    if t in (b'S', b'R'):
        n = struct.unpack_from('<I', buf, pos)[0]; pos += 4
        data = buf[pos:pos + n]; pos += n
        return (data.decode('utf-8', 'replace') if t == b'S' else data), pos
    raise ValueError(f'unknown FBX property type {t!r} at {pos}')

def read_node(buf, pos, version):
    if version >= 7500:
        end, nprops, plen = struct.unpack_from('<QQQ', buf, pos); pos += 24
    else:
        end, nprops, plen = struct.unpack_from('<III', buf, pos); pos += 12
    nlen = buf[pos]; pos += 1
    if end == 0: return None, pos
    name = buf[pos:pos + nlen].decode('ascii', 'replace'); pos += nlen
    props = []
    for _ in range(nprops):
        p, pos = read_prop(buf, pos); props.append(p)
    children = []
    while pos < end:
        child, pos = read_node(buf, pos, version)
        if child is None: break
        children.append(child)
    return Node(name, props, children), end

def read_fbx(path):
    buf = open(path, 'rb').read()
    if buf[:21] != b'Kaydara FBX Binary  \x00': raise ValueError(f'{path}: not a binary FBX (ASCII FBX is not supported; re-export as binary)')
    version = struct.unpack_from('<I', buf, 23)[0]
    pos = 27; top = []
    while pos < len(buf):
        node, pos = read_node(buf, pos, version)
        if node is None: break
        top.append(node)
    return Node('ROOT', [version], top)

def fbx_name(s):
    # "Model::mixamorig:Hips\x00\x01Model" -> "mixamorig:Hips"
    s = s.split('\x00')[0]
    return s.split('::', 1)[1] if '::' in s else s

def props70(node):
    out = {}
    p70 = node.child('Properties70')
    if not p70: return out
    for p in p70.all('P'):
        name = p.props[0]; vals = p.props[4:]
        out[name] = vals[0] if len(vals) == 1 else tuple(vals)
    return out

# --------------------------------------------------------------------------- math (numpy, xyzw quaternions)
def quat_from_euler_xyz_deg(rx, ry, rz):
    """FBX eEulerXYZ: rotate about X, then Y, then Z (extrinsic) => R = Rz Ry Rx => q = qz * qy * qx."""
    def axis(a, deg):
        h = math.radians(deg) / 2; s = math.sin(h); return np.array([a[0] * s, a[1] * s, a[2] * s, math.cos(h)])
    return qmul(qmul(axis((0, 0, 1), rz), axis((0, 1, 0), ry)), axis((1, 0, 0), rx))

def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return np.array([aw * bx + ax * bw + ay * bz - az * by,
                     aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw,
                     aw * bw - ax * bx - ay * by - az * bz])

def qnorm(q):
    n = np.linalg.norm(q); return q / n if n > 0 else np.array([0, 0, 0, 1.0])

def mat_from_trs(t, q, s):
    x, y, z, w = q
    r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    m = np.eye(4); m[:3, :3] = r * np.array(s)[None, :]; m[:3, 3] = t
    return m

# --------------------------------------------------------------------------- scene model
class Scene:
    def __init__(self, root, path):
        self.path = path
        self.objects = {}            # id -> Node
        self.conn_oo = []            # (child, parent)
        self.conn_op = []            # (child, parent, prop)
        objs = root.child('Objects')
        for o in objs.children: self.objects[o.props[0]] = o
        for c in root.child('Connections').all('C'):
            if c.props[0] == 'OO': self.conn_oo.append((c.props[1], c.props[2]))
            elif c.props[0] == 'OP': self.conn_op.append((c.props[1], c.props[2], c.props[3]))
        gs = props70(root.child('GlobalSettings')) if root.child('GlobalSettings') else {}
        self.unit_scale = float(gs.get('UnitScaleFactor', 1.0))
        self.models = {i: n for i, n in self.objects.items() if n.name == 'Model'}
        self.parent_of = {}
        for child, parent in self.conn_oo:
            if child in self.models and (parent in self.models or parent == 0): self.parent_of[child] = parent
        self.by_name = {fbx_name(n.props[1]): i for i, n in self.models.items()}

    def children_oo(self, parent_id, kind=None):
        return [self.objects[c] for c, p in self.conn_oo if p == parent_id and c in self.objects and (kind is None or self.objects[c].name == kind)]
    def parents_oo(self, child_id, kind=None):
        return [self.objects[p] for c, p in self.conn_oo if c == child_id and p in self.objects and (kind is None or self.objects[p].name == kind)]

    def local_trs(self, model):
        p = props70(model)
        t = np.array(p.get('Lcl Translation', (0, 0, 0)), dtype=float)
        r = p.get('Lcl Rotation', (0, 0, 0)); pre = p.get('PreRotation', (0, 0, 0)); post = p.get('PostRotation', (0, 0, 0))
        s = np.array(p.get('Lcl Scaling', (1, 1, 1)), dtype=float)
        if int(p.get('RotationOrder', 0)) != 0: print(f'  warning: {fbx_name(model.props[1])} uses rotation order {p["RotationOrder"]}; XYZ assumed', file=sys.stderr)
        for k in ('RotationOffset', 'RotationPivot', 'ScalingOffset', 'ScalingPivot'):
            if any(abs(v) > 1e-6 for v in p.get(k, (0, 0, 0))): print(f'  warning: {fbx_name(model.props[1])} has non-zero {k}; ignored', file=sys.stderr)
        q = qmul(quat_from_euler_xyz_deg(*pre), quat_from_euler_xyz_deg(*r))
        if any(abs(v) > 1e-6 for v in post): q = qmul(q, quat_conj(quat_from_euler_xyz_deg(*post)))
        return t, qnorm(q), s, np.array(pre, dtype=float), np.array(post, dtype=float)

def quat_conj(q): return np.array([-q[0], -q[1], -q[2], q[3]])

# --------------------------------------------------------------------------- mesh + skin
def build_mesh(sc):
    geos = [n for n in sc.objects.values() if n.name == 'Geometry' and n.props[2] == 'Mesh']
    if not geos: raise ValueError(f'{sc.path}: no mesh geometry')
    if len(geos) > 1: print(f'  note: {len(geos)} geometries; merging is not supported, using the largest', file=sys.stderr)
    geo = max(geos, key=lambda g: len(g.child('Vertices').props[0]))
    mesh_model = sc.parents_oo(geo.props[0], 'Model')[0]
    verts = geo.child('Vertices').props[0].reshape(-1, 3).astype(np.float64)
    pvi = geo.child('PolygonVertexIndex').props[0]
    # polygons -> triangles (fan), keeping the polygon-vertex index for per-corner attributes
    tris, corner_ids, poly_of_tri = [], [], []
    poly = []; poly_idx = 0
    for k, v in enumerate(pvi):
        idx = v if v >= 0 else ~v
        poly.append((int(idx), k))
        if v < 0:
            for i in range(1, len(poly) - 1):
                tris.append((poly[0][0], poly[i][0], poly[i + 1][0])); corner_ids.append((poly[0][1], poly[i][1], poly[i + 1][1])); poly_of_tri.append(poly_idx)
            poly = []; poly_idx += 1
    tris = np.array(tris, dtype=np.int64); corner_ids = np.array(corner_ids, dtype=np.int64); poly_of_tri = np.array(poly_of_tri)
    # normals
    ln = geo.child('LayerElementNormal')
    normals_corner = None
    if ln is not None:
        nrm = ln.child('Normals').props[0].reshape(-1, 3).astype(np.float64)
        mapping = ln.child('MappingInformationType').props[0]; ref = ln.child('ReferenceInformationType').props[0]
        if ref == 'IndexToDirect': nrm = nrm[ln.child('NormalsIndex').props[0]]
        if mapping == 'ByPolygonVertex': normals_corner = nrm[corner_ids]                      # (T,3,3)
        elif mapping == 'ByVertice' or mapping == 'ByVertex': normals_corner = nrm[tris]
        else: print(f'  warning: normals mapping {mapping} unsupported; recomputing', file=sys.stderr)
    # materials per polygon
    lm = geo.child('LayerElementMaterial')
    mat_of_tri = np.zeros(len(tris), dtype=np.int64)
    if lm is not None and lm.child('MappingInformationType').props[0] == 'ByPolygon':
        mat_of_tri = lm.child('Materials').props[0].astype(np.int64)[poly_of_tri]
    # skin
    skins = sc.children_oo(geo.props[0], 'Deformer')
    if not skins: raise ValueError(f'{sc.path}: mesh has no Skin deformer (export "with skin")')
    clusters = sc.children_oo(skins[0].props[0], 'Deformer')
    joints, ibms = [], []
    w = np.zeros((len(verts), 8), dtype=np.float64); j = np.zeros((len(verts), 8), dtype=np.int64); fill = np.zeros(len(verts), dtype=np.int64)
    # The mesh node's own world transform at bind. Cluster.Transform is NOT it
    # (Mixamo writes inverse(TransformLink) there); like three.js's FBXLoader we
    # take the mesh Model's transform and treat TransformLink as the bone's bind world.
    mt, mq, ms, _, _ = sc.local_trs(mesh_model)
    mesh_xform = mat_from_trs(mt, mq, ms)
    for ci, cl in enumerate(clusters):
        bones = sc.children_oo(cl.props[0], 'Model')
        if not bones: continue
        bone_id = bones[0].props[0]
        idxs = cl.child('Indexes'); wts = cl.child('Weights')
        tlink = np.array(cl.child('TransformLink').props[0], dtype=np.float64).reshape(4, 4).T   # FBX stores column-major
        joints.append(bone_id); ibms.append(np.linalg.inv(tlink))
        if idxs is not None:
            for vi, wv in zip(idxs.props[0], wts.props[0]):
                f = fill[vi]
                if f < 8: j[vi, f] = len(joints) - 1; w[vi, f] = wv; fill[vi] = f + 1
    # keep the 4 strongest weights, normalise
    order = np.argsort(-w, axis=1)[:, :4]
    w4 = np.take_along_axis(w, order, 1); j4 = np.take_along_axis(j, order, 1)
    ssum = w4.sum(1, keepdims=True); ssum[ssum == 0] = 1; w4 = w4 / ssum
    # vertices are in the mesh node's space; bake its bind transform so they sit in the skeleton's world
    if not np.allclose(mesh_xform, np.eye(4), atol=1e-6):
        print('  note: mesh node has a transform; baking it into the vertices', file=sys.stderr)
        verts = (mesh_xform @ np.c_[verts, np.ones(len(verts))].T).T[:, :3]
        if normals_corner is not None: normals_corner = normals_corner @ np.linalg.inv(mesh_xform[:3, :3])   # rows: n' = n M^-1 (inverse transpose, row form)
    # un-index into corners, then dedupe identical corners
    pos_c = verts[tris].reshape(-1, 3)
    if normals_corner is None:
        e1 = verts[tris[:, 1]] - verts[tris[:, 0]]; e2 = verts[tris[:, 2]] - verts[tris[:, 0]]
        n = np.cross(e1, e2); n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
        normals_corner = np.repeat(n[:, None, :], 3, axis=1)
    nrm_c = normals_corner.reshape(-1, 3)
    nrm_c = nrm_c / np.maximum(np.linalg.norm(nrm_c, axis=1, keepdims=True), 1e-12)
    j_c = j4[tris].reshape(-1, 4); w_c = w4[tris].reshape(-1, 4); mat_c = np.repeat(mat_of_tri, 3)
    key = np.round(np.c_[pos_c, nrm_c * 1000, j_c, w_c * 1000], 3)
    _, uniq, inverse = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inverse = inverse.reshape(-1)
    remap = np.empty(len(uniq), dtype=np.int64); remap[np.argsort(uniq)] = np.arange(len(uniq))
    new_index = remap[inverse]                          # corner -> new vertex id (sorted by first appearance)
    order_first = np.sort(uniq)
    P = pos_c[order_first].astype(np.float32); N = nrm_c[order_first].astype(np.float32)
    J = j_c[order_first].astype(np.uint8); W = w_c[order_first].astype(np.float32)
    # materials -> flat colours
    mats = sc.children_oo(mesh_model.props[0], 'Material')
    colours = []
    palette = [(0.55, 0.58, 0.63), (0.36, 0.39, 0.45), (0.80, 0.65, 0.52), (0.26, 0.28, 0.33), (0.62, 0.35, 0.30)]
    for mi, m in enumerate(mats):
        d = props70(m).get('DiffuseColor', (0.8, 0.8, 0.8))
        d = tuple(float(x) for x in d[:3])
        if all(abs(x - d[0]) < 0.05 for x in d) and d[0] > 0.6: d = palette[mi % len(palette)]   # textured "white" -> palette
        colours.append(d)
    if not colours: colours = [palette[0]]
    prims = []
    for mi in sorted(set(mat_of_tri.tolist())):
        sel = np.repeat(mat_of_tri == mi, 3)
        prims.append((new_index[sel].astype(np.uint32), colours[min(mi, len(colours) - 1)]))
    height = float(P[:, 1].max() - P[:, 1].min())
    return dict(P=P, N=N, J=J, W=W, prims=prims, joints=joints, ibms=ibms, mesh_model=mesh_model, height=height, ymin=float(P[:, 1].min()))

# --------------------------------------------------------------------------- skeleton
def build_skeleton(sc, mesh_model_id):
    """All Model nodes except the mesh, in parent-before-child order, with rest TRS."""
    ids = [i for i in sc.models if i != mesh_model_id]
    depth = {}
    def d(i):
        if i in depth: return depth[i]
        p = sc.parent_of.get(i, 0); depth[i] = 0 if p == 0 or p not in sc.models else d(p) + 1
        return depth[i]
    ids.sort(key=lambda i: (d(i), fbx_name(sc.models[i].props[1])))
    nodes = []
    for i in ids:
        m = sc.models[i]; t, q, s, pre, post = sc.local_trs(m)
        nodes.append(dict(id=i, name=fbx_name(m.props[1]), parent=sc.parent_of.get(i, 0), t=t, q=q, s=s, pre=pre, post=post))
    return nodes

def global_matrices(nodes):
    by_id = {n['id']: n for n in nodes}; G = {}
    for n in nodes:
        local = mat_from_trs(n['t'], n['q'], n['s'])
        G[n['id']] = (G[n['parent']] @ local) if n['parent'] in G else local
    return G

# --------------------------------------------------------------------------- animation
def build_clip(sc, skeleton_by_name, name, strip_root_motion):
    stacks = [n for n in sc.objects.values() if n.name == 'AnimationStack']
    if not stacks: raise ValueError(f'{sc.path}: no animation stack')
    layers = sc.children_oo(stacks[0].props[0], 'AnimationLayer')
    curve_nodes = sc.children_oo(layers[0].props[0], 'AnimationCurveNode')
    cn_ids = {c.props[0] for c in curve_nodes}
    # curve node -> (model, property)
    target = {}
    for child, parent, prop in sc.conn_op:
        if child in cn_ids and parent in sc.models: target[child] = (parent, prop)
    tracks = {}   # bone name -> {'T': {...}, 'R': {...}}
    for cn in curve_nodes:
        if cn.props[0] not in target: continue
        model_id, prop = target[cn.props[0]]
        bone = fbx_name(sc.models[model_id].props[1])
        if bone not in skeleton_by_name: continue
        kind = {'Lcl Rotation': 'R', 'Lcl Translation': 'T'}.get(prop)
        if kind is None: continue
        defaults = props70(cn)
        comps = {}
        for child, parent, cprop in sc.conn_op:
            if parent == cn.props[0] and child in sc.objects and sc.objects[child].name == 'AnimationCurve':
                curve = sc.objects[child]
                comps[cprop[-1]] = (curve.child('KeyTime').props[0].astype(np.float64) / FBX_TIME, curve.child('KeyValueFloat').props[0].astype(np.float64))
        if not comps: continue
        times = np.unique(np.concatenate([c[0] for c in comps.values()]))
        vals = np.zeros((len(times), 3))
        for k, axis in enumerate('XYZ'):
            if axis in comps: vals[:, k] = np.interp(times, comps[axis][0], comps[axis][1])
            else: vals[:, k] = float(defaults.get('d|' + axis, 0.0))
        tracks.setdefault(bone, {})[kind] = (times - times[0], vals)
    if not tracks: raise ValueError(f'{sc.path}: no usable curves')
    # rotation: quaternion = pre * euler(anim) (post ignored unless present, handled as rest)
    out = {}
    root_speed = 0.0; root_dir = None
    for bone, tr in tracks.items():
        rest = skeleton_by_name[bone]
        entry = {}
        if 'R' in tr:
            times, vals = tr['R']
            qs = np.array([qnorm(qmul(quat_from_euler_xyz_deg(*rest['pre']), quat_from_euler_xyz_deg(*v))) for v in vals])
            # keep quaternion continuity for slerp
            for i in range(1, len(qs)):
                if np.dot(qs[i], qs[i - 1]) < 0: qs[i] = -qs[i]
            entry['R'] = (times, qs)
        if 'T' in tr:
            times, vals = tr['T']
            vals = vals.copy()
            if rest['parent'] not in skeleton_by_name_ids(skeleton_by_name):
                # root bone: measure the horizontal travel (that is the clip's natural speed, which the
                # controller uses to time-scale the walk), then remove it so the controller owns position
                dx, dz = vals[-1, 0] - vals[0, 0], vals[-1, 2] - vals[0, 2]
                dur = max(times[-1], 1e-6)
                root_speed = float(math.hypot(dx, dz) / dur); root_dir = (float(dx), float(dz))
                if strip_root_motion:
                    vals[:, 0] = vals[0, 0]; vals[:, 2] = vals[0, 2]
            entry['T'] = (times, vals)
        out[bone] = entry
    duration = max(max(v[0][-1] for v in e.values()) for e in out.values())
    return dict(name=name, tracks=out, duration=float(duration), root_speed=root_speed, root_dir=root_dir)

def skeleton_by_name_ids(skeleton_by_name): return {n['id'] for n in skeleton_by_name.values()}

# --------------------------------------------------------------------------- glTF writer
class GlbWriter:
    def __init__(self):
        self.bin = bytearray(); self.views = []; self.accessors = []
    def pad(self):
        while len(self.bin) % 4: self.bin.append(0)
    def add(self, arr, ctype, atype, target=None, minmax=False):
        self.pad(); off = len(self.bin); data = np.ascontiguousarray(arr).tobytes(); self.bin += data
        view = dict(buffer=0, byteOffset=off, byteLength=len(data))
        if target: view['target'] = target
        self.views.append(view)
        acc = dict(bufferView=len(self.views) - 1, componentType=ctype, count=int(arr.shape[0]), type=atype)
        if minmax:
            a = np.asarray(arr); acc['min'] = a.min(0).tolist() if a.ndim > 1 else [float(a.min())]; acc['max'] = a.max(0).tolist() if a.ndim > 1 else [float(a.max())]
        self.accessors.append(acc); return len(self.accessors) - 1
    def finish(self, doc, path):
        self.pad()
        doc['buffers'] = [dict(byteLength=len(self.bin))]; doc['bufferViews'] = self.views; doc['accessors'] = self.accessors
        js = json.dumps(doc, separators=(',', ':')).encode()
        while len(js) % 4: js += b' '
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, total))
            f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
            f.write(struct.pack('<II', len(self.bin), 0x004E4942)); f.write(self.bin)
        return total

FLOAT, UBYTE, USHORT, UINT = 5126, 5121, 5123, 5125

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('character'); ap.add_argument('anims', nargs='*')
    ap.add_argument('-o', '--out', required=True); ap.add_argument('--js', help='also write a JS module exporting the GLB as base64')
    ap.add_argument('--name', default='Mannequin')
    ap.add_argument('--keep-root-motion', action='store_true')
    args = ap.parse_args()

    print(f'character: {args.character}')
    sc = Scene(read_fbx(args.character), args.character)
    if abs(sc.unit_scale - 1.0) > 1e-6: print(f'  note: UnitScaleFactor {sc.unit_scale} (1.0 = centimetres); values are exported as-is', file=sys.stderr)
    mesh = build_mesh(sc)
    skeleton = build_skeleton(sc, mesh['mesh_model'].props[0])
    by_name = {n['name']: n for n in skeleton}
    G = global_matrices(skeleton)
    # sanity: rest pose must reproduce the bind pose
    worst = 0.0
    for jid, ibm in zip(mesh['joints'], mesh['ibms']):
        worst = max(worst, float(np.abs(G[jid] @ ibm - np.eye(4)).max()))
    print(f'  mesh: {len(mesh["P"])} vertices, {sum(len(p[0]) // 3 for p in mesh["prims"])} triangles, {len(mesh["prims"])} materials, height {mesh["height"]:.1f} (y min {mesh["ymin"]:.1f})')
    print(f'  skeleton: {len(skeleton)} nodes, {len(mesh["joints"])} joints, rest-vs-bind max error {worst:.4f}')
    if worst > 0.5: print('  warning: rest pose does not match bind pose; check PreRotation / pivots', file=sys.stderr)

    clips = []
    for a in args.anims:
        asc = Scene(read_fbx(a), a)
        nm = os.path.splitext(os.path.basename(a))[0].strip().lower().replace(' ', '_')
        try:
            clip = build_clip(asc, by_name, nm, strip_root_motion=not args.keep_root_motion)
        except ValueError as e:
            print(f'  skip {a}: {e}', file=sys.stderr); continue
        missing = [b for b in clip['tracks'] if b not in by_name]
        rd = clip['root_dir']
        print(f'  clip {nm}: {clip["duration"]:.2f}s, {len(clip["tracks"])} bones, root travel {clip["root_speed"]:.0f} u/s' + (f' toward ({rd[0]:+.0f}, {rd[1]:+.0f})' if rd else '') + (f', {len(missing)} unmatched' if missing else ''))
        clips.append(clip)

    # ---- glTF document ----
    w = GlbWriter()
    node_index = {}      # fbx id -> gltf node index
    nodes = []
    for n in skeleton:
        node_index[n['id']] = len(nodes)
        nodes.append(dict(name=n['name'], translation=[float(x) for x in n['t']], rotation=[float(x) for x in n['q']], scale=[float(x) for x in n['s']]))
    for n in skeleton:
        if n['parent'] in node_index: nodes[node_index[n['parent']]].setdefault('children', []).append(node_index[n['id']])
    roots = [node_index[n['id']] for n in skeleton if n['parent'] not in node_index]
    # mesh node (skinned; its own transform is ignored by skinning, kept identity)
    pos_acc = w.add(mesh['P'], FLOAT, 'VEC3', 34962, minmax=True)
    nrm_acc = w.add(mesh['N'], FLOAT, 'VEC3', 34962)
    j_acc = w.add(mesh['J'], UBYTE, 'VEC4', 34962)
    wt_acc = w.add(mesh['W'], FLOAT, 'VEC4', 34962)
    materials, prims = [], []
    for k, (idx, col) in enumerate(mesh['prims']):
        materials.append(dict(name=f'{args.name}_{k}', pbrMetallicRoughness=dict(baseColorFactor=[col[0], col[1], col[2], 1.0], metallicFactor=0.0, roughnessFactor=0.9)))
        if idx.max() < 65535: i_acc = w.add(idx.astype(np.uint16), USHORT, 'SCALAR', 34963)
        else: i_acc = w.add(idx.astype(np.uint32), UINT, 'SCALAR', 34963)
        prims.append(dict(attributes=dict(POSITION=pos_acc, NORMAL=nrm_acc, JOINTS_0=j_acc, WEIGHTS_0=wt_acc), indices=i_acc, material=k, mode=4))
    ibm = np.array([m.T for m in mesh['ibms']], dtype=np.float32).reshape(-1, 16)     # glTF matrices are column-major
    ibm_acc = w.add(ibm, FLOAT, 'MAT4')
    joints_gltf = [node_index[j] for j in mesh['joints']]
    mesh_node = len(nodes)
    nodes.append(dict(name=args.name, mesh=0, skin=0))
    animations = []
    for clip in clips:
        samplers, channels = [], []
        for bone, entry in clip['tracks'].items():
            if bone not in by_name: continue
            target_node = node_index[by_name[bone]['id']]
            if 'R' in entry:
                t, q = entry['R']
                ti = w.add(t.astype(np.float32), FLOAT, 'SCALAR', minmax=True); vi = w.add(q.astype(np.float32), FLOAT, 'VEC4')
                samplers.append(dict(input=ti, output=vi, interpolation='LINEAR')); channels.append(dict(sampler=len(samplers) - 1, target=dict(node=target_node, path='rotation')))
            if 'T' in entry:
                t, v = entry['T']
                ti = w.add(t.astype(np.float32), FLOAT, 'SCALAR', minmax=True); vi = w.add(v.astype(np.float32), FLOAT, 'VEC3')
                samplers.append(dict(input=ti, output=vi, interpolation='LINEAR')); channels.append(dict(sampler=len(samplers) - 1, target=dict(node=target_node, path='translation')))
        animations.append(dict(name=clip['name'], samplers=samplers, channels=channels, extras=dict(rootSpeed=round(clip['root_speed'], 2), duration=round(clip['duration'], 4))))
    doc = dict(
        asset=dict(version='2.0', generator='ptah fbx2ptah.py', extras=dict(source='Adobe Mixamo', height=mesh['height'], ymin=mesh['ymin'])),
        scene=0, scenes=[dict(nodes=roots + [mesh_node])], nodes=nodes,
        meshes=[dict(name=args.name, primitives=prims)], materials=materials,
        skins=[dict(name=args.name, inverseBindMatrices=ibm_acc, joints=joints_gltf, skeleton=roots[0])],
        animations=animations)
    size = w.finish(doc, args.out)
    print(f'wrote {args.out}: {size / 1e6:.2f} MB, {len(animations)} clips')
    if args.js:
        import base64
        b64 = base64.b64encode(open(args.out, 'rb').read()).decode()
        with open(args.js, 'w') as f:
            f.write('// Generated by tools/mixamo/fbx2ptah.py from an Adobe Mixamo character and animation pack.\n')
            f.write('// A base64 GLB so the app can import it as a module under a strict CSP (no fetch). Do not edit.\n')
            f.write(f'export const name = {json.dumps(args.name)};\nexport const clips = {json.dumps([c["name"] for c in clips])};\nexport const height = {mesh["height"]:.3f};\n')
            f.write(f'export const glbBase64 = "{b64}";\n')
        print(f'wrote {args.js}: {os.path.getsize(args.js) / 1e6:.2f} MB')

if __name__ == '__main__':
    main()
