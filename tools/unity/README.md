# Ptah Markers for Unity

Turns the gameplay markers in a Ptah blockout into scene objects. Checked in Unity 6.3 LTS with Unity's USD Importer (`com.unity.importer.usd` 1.0.0-pre.2); written for 2022.3 and later.

**Install:** Window → Package Manager → + → **Install package from git URL**:

    https://github.com/SMUGSterling/Ptah.git?path=/tools/unity#v0.11.0

(Unity needs Git installed to fetch it. Change the tag at the end to take a later version.)

**Use:** import the `.usda`, drag it into a scene, select the level, then **Tools → Ptah → Convert Markers in Selection…** and pick the same `.usda`. Each marker gets a **PtahMarker** component with its kind and tags; player starts are tagged `Respawn`; trigger volumes get a trigger **BoxCollider** sized to Ptah's box. The Console says how many markers were converted and how the importer converted units and axes.

Full guide: [docs/importing.md](https://github.com/SMUGSterling/Ptah/blob/main/docs/importing.md#unity).
