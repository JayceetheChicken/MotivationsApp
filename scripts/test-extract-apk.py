"""Regression tests for safe, case-preserving APK inspection on Windows/Linux."""
import pathlib
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile


class ExtractionTests(unittest.TestCase):
    def run_archive(self, members):
        self.directory = tempfile.TemporaryDirectory(prefix='lernzeit-apk-test-')
        self.addCleanup(self.directory.cleanup)
        root = pathlib.Path(self.directory.name)
        archive = root / 'test.apk'
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)  # intentional duplicate fixture
            with zipfile.ZipFile(archive, 'w') as apk:
                for name, content in members:
                    entry = zipfile.ZipInfo('fixture')
                    # ZipInfo's constructor normalizes Windows separators;
                    # set the raw ZIP name afterwards to test hostile input.
                    entry.filename = name
                    apk.writestr(entry, content)
        output = root / 'inspection'
        result = subprocess.run([
            sys.executable, str(pathlib.Path(__file__).with_name('extract-apk.py')),
            str(archive), str(output)
        ], capture_output=True, text=True, check=False)
        return result, output

    def test_keeps_case_distinct_resource_bytes_and_named_assets(self):
        result, output = self.run_archive([
            ('res/AB.xml', b'upper'), ('res/ab.xml', b'lower'),
            ('assets/app.config', b'config'), ('assets/index.android.bundle', b'bundle')
        ])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((output / 'assets/app.config').read_bytes(), b'config')
        self.assertEqual((output / 'assets/index.android.bundle').read_bytes(), b'bundle')
        self.assertEqual(sorted(p.read_bytes() for p in output.rglob('*') if p.is_file()),
                         sorted([b'upper', b'lower', b'config', b'bundle']))

    def test_rejects_traversal_absolute_and_windows_paths(self):
        for name in ['../escape', '/escape', 'C:/escape', 'a\\escape']:
            with self.subTest(name=name):
                result, _ = self.run_archive([(name, b'bad')])
                self.assertNotEqual(result.returncode, 0)

    def test_rejects_duplicate_entries(self):
        result, _ = self.run_archive([('assets/app.config', b'a'), ('assets/app.config', b'b')])
        self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
