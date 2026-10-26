"""Security and source-discovery regressions for the translation audit utility."""
import tempfile
import unittest
import contextlib
import io
import json
from unittest.mock import patch
from pathlib import Path

from unused import source_texts, unused_keys
import unused


class UnusedKeysTests(unittest.TestCase):
    def test_command_writes_a_literal_report_in_the_requested_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'src' / 'strings').mkdir(parents=True)
            (root / 'scripts').mkdir()
            keys = {'Used.Key': 'used', 'Unused.Key': 'unused'}
            (root / 'src' / 'strings' / 'en-us.json').write_text(json.dumps(keys), encoding='utf-8')
            (root / 'src' / 'view.tsx').write_text("translate('Used.Key')", encoding='utf-8')
            output = io.StringIO()
            with patch.object(unused, '__file__', str(root / 'scripts' / 'unused.py')), contextlib.chdir(root), contextlib.redirect_stdout(output):
                unused.main()
            self.assertEqual((root / 'unused.txt').read_text(), 'Unused.Key\n')
            self.assertIn('DONE: Used.Key', output.getvalue())
            self.assertIn('UNUSED: Unused.Key', output.getvalue())
            self.assertIn('LENGTH: 1', output.getvalue())

    def test_translation_keys_are_literal_data(self):
        keys = ['Used.Key', 'Unused.Key', 'UsedXKey', "$(touch sentinel);'quoted"]
        self.assertEqual(unused_keys(keys, ['translate("Used.Key")']), keys[1:])
        self.assertEqual(unused_keys(['A+B'], ["translate('A+B')"]), [])

    def test_shell_syntax_is_never_executed(self):
        with tempfile.TemporaryDirectory() as directory:
            sentinel = Path(directory) / 'executed'
            key = f'$(touch {sentinel})'
            self.assertEqual(unused_keys([key], [f'"{key}"']), [])
            self.assertFalse(sentinel.exists())

    def test_source_discovery_excludes_dictionaries_and_reads_react(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            (source / 'strings').mkdir()
            (source / 'strings' / 'dict.ts').write_text('"DictionaryOnly"', encoding='utf-8')
            (source / 'component.tsx').write_text("translate('Used')", encoding='utf-8')
            (source / 'ignored.txt').write_text('"Ignored"', encoding='utf-8')
            self.assertEqual(unused_keys(['Used', 'DictionaryOnly', 'Ignored'], source_texts(source)), ['DictionaryOnly', 'Ignored'])


if __name__ == '__main__':
    unittest.main()
