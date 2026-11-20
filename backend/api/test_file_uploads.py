from io import BytesIO
import zipfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db.models.fields.files import FieldFile
from django.test import SimpleTestCase

from .file_uploads import (
    FILE_TYPES,
    MAX_STUDENT_SUBMISSION_BYTES,
    MAX_STUDENT_SUBMISSION_FILES,
    MAX_STUDENT_VIDEO_BYTES,
    MIB,
    UploadValidationError,
    validate_student_submission_files,
    validate_uploaded_file,
    validate_uploaded_files,
)


class SizedUpload:
    def __init__(self, name, content, size=None):
        self.name = name
        self.content = BytesIO(content)
        self.size = len(content) if size is None else size

    def read(self, size=-1):
        return self.content.read(size)

    def seek(self, offset, whence=0):
        return self.content.seek(offset, whence)


class ExistingStoredVideo(FieldFile):
    def __init__(self, name, size):
        self.name = name
        self._size = size
        self._file = BytesIO(b'\x00\x00\x00\x18ftypisom')

    @property
    def size(self):
        return self._size

    def seek(self, offset, whence=0):
        return self._file.seek(offset, whence)

    def read(self, size=-1):
        return self._file.read(size)

    def close(self):
        self._file.close()


def office_file(name, root_file):
    contents = BytesIO()
    with zipfile.ZipFile(contents, 'w') as archive:
        archive.writestr('[Content_Types].xml', '<Types/>')
        archive.writestr(root_file, 'office content')
    return SimpleUploadedFile(name, contents.getvalue(), content_type='application/zip')


class UploadPolicyTests(SimpleTestCase):
    def test_supported_formats_are_checked_by_content_signature(self):
        uploads = [
            SimpleUploadedFile('clip.mp4', b'\x00\x00\x00\x18ftypisomdata'),
            SimpleUploadedFile('clip.mov', b'\x00\x00\x00\x18ftypqt  data'),
            SimpleUploadedFile('clip.webm', b'\x1a\x45\xdf\xa3data'),
            SimpleUploadedFile('photo.jpg', b'\xff\xd8\xffdata'),
            SimpleUploadedFile('photo.jpeg', b'\xff\xd8\xffdata'),
            SimpleUploadedFile('photo.png', b'\x89PNG\r\n\x1a\ndata'),
            SimpleUploadedFile('photo.webp', b'RIFFxxxxWEBPdata'),
            SimpleUploadedFile('brief.pdf', b'%PDF-1.7 data'),
            office_file('brief.docx', 'word/document.xml'),
            office_file('brief.pptx', 'ppt/presentation.xml'),
            office_file('brief.xlsx', 'xl/workbook.xml'),
            SimpleUploadedFile('voice.mp3', b'ID3data'),
            SimpleUploadedFile('voice.wav', b'RIFFxxxxWAVEdata'),
        ]

        self.assertEqual(validate_uploaded_files(uploads), [])
        self.assertEqual(len(FILE_TYPES), len(uploads))

    def test_each_category_enforces_its_per_file_size_limit(self):
        cases = [
            ('large.mp4', b'\x00\x00\x00\x18ftypisom', 500 * MIB),
            ('large.png', b'\x89PNG\r\n\x1a\n', 20 * MIB),
            ('large.pdf', b'%PDF-1.7', 25 * MIB),
            ('large.mp3', b'ID3data', 50 * MIB),
        ]
        for name, signature, maximum in cases:
            with self.subTest(name=name):
                upload = SizedUpload(name, signature, maximum + 1)
                with self.assertRaises(UploadValidationError):
                    validate_uploaded_file(upload)

    def test_unsupported_extension_and_mismatched_contents_are_rejected(self):
        unsupported = validate_uploaded_files([SimpleUploadedFile('archive.zip', b'PK\x03\x04')])
        mismatched = validate_uploaded_files([SimpleUploadedFile('not-a-pdf.pdf', b'plain text')])

        self.assertIn('unsupported format', unsupported[0])
        self.assertIn('do not match', mismatched[0])

    def test_submission_file_count_includes_existing_files(self):
        six_files = [SimpleUploadedFile(f'image-{index}.png', b'\x89PNG\r\n\x1a\ndata') for index in range(6)]
        errors = validate_student_submission_files(six_files)
        existing_limit_error = validate_student_submission_files(
            [SimpleUploadedFile('sixth.png', b'\x89PNG\r\n\x1a\ndata')],
            existing_files=[SimpleUploadedFile(f'existing-{index}.png', b'\x89PNG\r\n\x1a\ndata') for index in range(5)],
        )

        self.assertIn('at most 5 files', ' '.join(errors))
        self.assertIn('at most 5 files', ' '.join(existing_limit_error))
        self.assertEqual(MAX_STUDENT_SUBMISSION_FILES, 5)

    def test_submission_combined_limit_includes_existing_files(self):
        direct_request_uploads = [
            SizedUpload('first.mp4', b'\x00\x00\x00\x18ftypisom', 500 * MIB),
            SizedUpload('second.mp4', b'\x00\x00\x00\x18ftypisom', 251 * MIB),
        ]
        at_total_limit = [
            ExistingStoredVideo('first.mp4', 5 * 1024 * MIB),
            ExistingStoredVideo('second.mp4', 5 * 1024 * MIB),
        ]
        over_total_limit = [*at_total_limit, ExistingStoredVideo('third.mp4', 1)]

        self.assertEqual(validate_student_submission_files(direct_request_uploads), [])
        self.assertEqual(validate_student_submission_files(at_total_limit), [])
        self.assertIn('10 GB', ' '.join(validate_student_submission_files(over_total_limit)))
        self.assertEqual(MAX_STUDENT_VIDEO_BYTES, 5 * 1024 ** 3)
        self.assertEqual(MAX_STUDENT_SUBMISSION_BYTES, 10 * 1024 ** 3)
