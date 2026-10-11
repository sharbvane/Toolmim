"""Thin subprocess bridge to an existing standalone BMTS Lite worker, no engine copy."""
import argparse
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--workspace', required=True)
    parser.add_argument('--request', required=True)
    args = parser.parse_args()
    root, workspace = Path(args.root).resolve(), Path(args.workspace).resolve()
    request = json.loads(Path(args.request).read_text(encoding='utf-8'))
    if not (root / 'worker.py').is_file() or not (root / 'engine/montage.py').is_file():
        raise ValueError('BMTS Lite root must contain its actual worker.py and engine')
    if not isinstance(request.get('media'), list) or len(request['media']) < 3:
        raise ValueError('Two videos plus one audio file are required')
    sys.path[:0] = [str(root), str(root / 'engine')]
    from worker import run
    def update(message, _percent):
        print('TUMING_STAGE ' + json.dumps({'message': message}, ensure_ascii=False), flush=True)
    result = run(workspace, request, update)
    report = {'engine': 'BMTS Lite worker.run', 'engine_root': str(root), 'passed': True,
              'verification_scope': 'worker built-in programmatic QA',
              'whole_audio_track': True, 'agent_visual_review': False, **result}
    (workspace / 'render_report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'{type(error).__name__}: {error}', file=sys.stderr)
        sys.exit(1)
