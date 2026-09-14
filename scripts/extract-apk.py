"""Extract an APK for inspection; reject traversal, duplicates and ZIP bombs."""
import pathlib
import sys
import zipfile

archive, destination = map(pathlib.Path, sys.argv[1:])
destination.mkdir(parents=True, exist_ok=False)
root = destination.resolve()
with zipfile.ZipFile(archive) as apk:
    entries = apk.infolist()
    if len(entries) > 20000 or sum(e.file_size for e in entries) > 1024**3:
        raise ValueError("APK exceeds inspection limits")
    seen = set()
    for entry in entries:
        target = (root / entry.filename).resolve()
        if not target.is_relative_to(root) or target == root or target in seen:
            raise ValueError("Unsafe or duplicate APK entry")
        seen.add(target)
        if entry.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            if entry.file_size > 128 * 1024**2:
                raise ValueError("APK member exceeds inspection limit")
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as output:
                output.write(apk.read(entry))
print(f"APK extracted for inspection: {len(entries)} entries")
