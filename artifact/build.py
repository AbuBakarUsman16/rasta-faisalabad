# app.html + fsd-roads.js -> index.html (publish hone wali aik file)
src = open("app.html", encoding="utf-8").read()
data = open("fsd-roads.js", encoding="utf-8").read()
assert "//@@FSD@@" in src
open("index.html", "w", encoding="utf-8").write(src.replace("//@@FSD@@", data))
