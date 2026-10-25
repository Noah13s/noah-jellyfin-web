"""Security and source-discovery regressions for the translation audit utility."""
import tempfile
import unittest
from pathlib import Path

from unused import source_texts, unused_keys


class UnusedKeysTests(unittest.TestCase):
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
