import os
import stat
import tempfile
import unittest
from pathlib import Path

from render_device_api_key import render_include


class RenderDeviceApiKeyTests(unittest.TestCase):
    def test_writes_private_nginx_header_include(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            environment_file = root / 'nfc.env'
            output_file = root / 'run' / 'cabinet-device-key.conf'
            environment_file.write_text(
                'DEVICE_API_KEY=device-test-key-0123456789\nTAPTRACK_NFC_MODE=hardware\n',
                encoding='utf-8',
            )

            render_include(environment_file, output_file)

            self.assertEqual(
                output_file.read_text(encoding='ascii'),
                'proxy_set_header X-API-Key "device-test-key-0123456789";\n',
            )
            if os.name == 'posix':
                self.assertEqual(stat.S_IMODE(output_file.stat().st_mode) & 0o077, 0)

    def test_rejects_missing_or_unsafe_key_without_creating_output(self):
        for contents in ('TAPTRACK_NFC_MODE=hardware\n', 'DEVICE_API_KEY=unsafe"; include /tmp/x;\n'):
            with self.subTest(contents=contents), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                environment_file = root / 'nfc.env'
                output_file = root / 'run' / 'cabinet-device-key.conf'
                environment_file.write_text(contents, encoding='utf-8')

                with self.assertRaises(ValueError):
                    render_include(environment_file, output_file)
                self.assertFalse(output_file.exists())


if __name__ == '__main__':
    unittest.main()