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
    for index, entry in enumerate(entries):
        # APK resource names are case-sensitive; Windows paths are not. Keep
        # the two named inputs used by the scanner, and map every other file
        # to a unique numeric name. Every byte is still scanned, including
        # resources such as res/AB.xml and res/ab.xml, without overwriting.
        # ZipInfo normalizes backslashes on Windows and truncates NULs; check
        # the original archive name before either transformation can hide it.
        original_name = entry.orig_filename
        member = pathlib.PurePosixPath(original_name)
        if (member.is_absolute() or not member.parts or '..' in member.parts
                or '\\' in original_name or ':' in original_name or '\0' in original_name
                or member in seen):
            raise ValueError("Unsafe or duplicate APK entry")
        seen.add(member)
        if entry.is_dir():
            continue
        else:
            if entry.file_size > 128 * 1024**2:
                raise ValueError("APK member exceeds inspection limit")
            relative = (member if entry.filename in (
                'assets/app.config', 'assets/index.android.bundle'
            ) else pathlib.PurePosixPath('entries', f'{index:05d}.bin'))
            target = root.joinpath(*relative.parts).resolve()
            if not target.is_relative_to(root):
                raise ValueError("Unsafe extraction destination")
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as output:
                output.write(apk.read(entry))
print(f"APK extracted for inspection: {len(entries)} entries")
