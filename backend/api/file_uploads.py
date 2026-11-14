import os
import zipfile

from django.db.models.fields.files import FieldFile


MIB = 1024 * 1024
MAX_STUDENT_SUBMISSION_FILES = 5
MAX_STUDENT_SUBMISSION_BYTES = 750 * MIB

FILE_TYPES = {
    '.mp4': ('video', 500 * MIB),
    '.mov': ('video', 500 * MIB),
    '.webm': ('video', 500 * MIB),
    '.jpg': ('image', 20 * MIB),
    '.jpeg': ('image', 20 * MIB),
    '.png': ('image', 20 * MIB),
    '.webp': ('image', 20 * MIB),
    '.pdf': ('document', 25 * MIB),
    '.docx': ('document', 25 * MIB),
    '.pptx': ('document', 25 * MIB),
    '.xlsx': ('document', 25 * MIB),
    '.mp3': ('audio', 50 * MIB),
    '.wav': ('audio', 50 * MIB),
}

SUPPORTED_EXTENSIONS = ', '.join(FILE_TYPES)


class UploadValidationError(ValueError):
    pass


def uploaded_file_size(uploaded_file):
    try:
        size = int(uploaded_file.size)
    except (AttributeError, OSError, TypeError, ValueError):
        raise UploadValidationError('The uploaded file size could not be determined.')
    if size < 0:
        raise UploadValidationError('The uploaded file size is invalid.')
    return size


def uploaded_file_name(uploaded_file):
    raw_name = str(getattr(uploaded_file, 'name', '') or '').replace('\\', '/')
    return os.path.basename(raw_name) or 'uploaded file'


def _content_matches(uploaded_file, extension):
    is_storage_field = isinstance(uploaded_file, FieldFile)
    was_open = is_storage_field and uploaded_file._file is not None
    try:
        uploaded_file.seek(0)
        header = uploaded_file.read(16)
    except (AttributeError, OSError, ValueError):
        return False
    finally:
        if is_storage_field and not was_open:
            uploaded_file.close()
        else:
            try:
                uploaded_file.seek(0)
            except (AttributeError, OSError, ValueError):
                pass

    if extension in ('.jpg', '.jpeg'):
        return header.startswith(b'\xff\xd8\xff')
    if extension == '.png':
        return header.startswith(b'\x89PNG\r\n\x1a\n')
    if extension == '.webp':
        return header.startswith(b'RIFF') and header[8:12] == b'WEBP'
    if extension == '.pdf':
        return header.startswith(b'%PDF-')
    if extension in ('.mp4', '.mov'):
        return len(header) >= 8 and header[4:8] == b'ftyp'
    if extension == '.webm':
        return header.startswith(b'\x1a\x45\xdf\xa3')
    if extension == '.mp3':
        return header.startswith(b'ID3') or (
            len(header) >= 2 and header[0] == 0xff and (header[1] & 0xe0) == 0xe0
        )
    if extension == '.wav':
        return header.startswith(b'RIFF') and header[8:12] == b'WAVE'
    if extension in ('.docx', '.pptx', '.xlsx'):
        required_part = {
            '.docx': 'word/document.xml',
            '.pptx': 'ppt/presentation.xml',
            '.xlsx': 'xl/workbook.xml',
        }[extension]
        try:
            uploaded_file.seek(0)
            with zipfile.ZipFile(uploaded_file) as archive:
                names = set(archive.namelist())
            return '[Content_Types].xml' in names and required_part in names
        except (OSError, ValueError, zipfile.BadZipFile, zipfile.LargeZipFile):
            return False
        finally:
            if is_storage_field and not was_open:
                uploaded_file.close()
            else:
                try:
                    uploaded_file.seek(0)
                except (AttributeError, OSError, ValueError):
                    pass
    return False


def validate_uploaded_file(uploaded_file):
    name = uploaded_file_name(uploaded_file)
    extension = os.path.splitext(name)[1].lower()
    spec = FILE_TYPES.get(extension)
    if spec is None:
        raise UploadValidationError(
            f'{name}: unsupported format. Supported formats: {SUPPORTED_EXTENSIONS}.'
        )

    category, maximum_size = spec
    size = uploaded_file_size(uploaded_file)
    if size > maximum_size:
        maximum_mb = maximum_size // MIB
        raise UploadValidationError(
            f'{name}: {category.capitalize()} files must be {maximum_mb} MB or smaller.'
        )
    if not _content_matches(uploaded_file, extension):
        raise UploadValidationError(
            f'{name}: file contents do not match the .{extension[1:]} format.'
        )
    return size


def validate_uploaded_files(files):
    errors = []
    for uploaded_file in files:
        try:
            validate_uploaded_file(uploaded_file)
        except UploadValidationError as error:
            errors.append(str(error))
    return errors


def validate_student_submission_files(files, existing_files=()):
    files = list(files)
    existing_files = list(existing_files)
    errors = validate_uploaded_files(files)
    all_files = [*existing_files, *files]
    if len(all_files) > MAX_STUDENT_SUBMISSION_FILES:
        errors.append(
            f'A submission can contain at most {MAX_STUDENT_SUBMISSION_FILES} files.'
        )

    total_size = 0
    for uploaded_file in all_files:
        try:
            total_size += uploaded_file_size(uploaded_file)
        except UploadValidationError:
            continue
    if total_size > MAX_STUDENT_SUBMISSION_BYTES:
        errors.append('Combined submission files must not exceed 750 MB.')
    return errors
