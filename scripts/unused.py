"""Report literal translation keys with no source references.

Dynamic translation keys still require manual review. Translation content is
data, including quotes and regex metacharacters; no shell is used.
"""
import json
import re
from pathlib import Path


def source_texts(source: Path):
    """Read executable templates once, excluding translation dictionaries."""
    strings = (source / 'strings').resolve()
    for path in source.rglob('*'):
        if path.suffix in {'.js', '.jsx', '.ts', '.tsx', '.html'} and not path.resolve().is_relative_to(strings):
            yield path.read_text(encoding='utf-8')


def unused_keys(keys, texts):
    texts = tuple(texts)
    return [key for key in keys if not any(
        re.search(r'''["'{]''' + re.escape(key) + r'''["'}]''', text)
        for text in texts
    )]


def main():
    source = Path(__file__).resolve().parents[1] / 'src'
    keys = json.loads((source / 'strings' / 'en-us.json').read_text(encoding='utf-8'))
    unused = unused_keys(keys, source_texts(source))
    unused_set = set(unused)
    for key in keys:
        print(('UNUSED: ' if key in unused_set else 'DONE: ') + key)
    print(unused)
    print('LENGTH: ' + str(len(unused)))
    Path('unused.txt').write_text(''.join(key + '\n' for key in unused), encoding='utf-8')


if __name__ == '__main__':
    main()
