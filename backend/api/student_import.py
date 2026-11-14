import csv
import io
import re
import zipfile
from collections import defaultdict

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import models
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils.exceptions import InvalidFileException

from .models import Section, User


IMPORT_COLUMNS = ('student_id', 'first_name', 'last_name', 'email', 'role', 'subject')
EXPECTED_HEADERS = ('student id', 'first name', 'last name', 'email', 'role', 'subject')
INSTRUCTOR_IMPORT_COLUMNS = ('instructor_id', 'first_name', 'last_name', 'email', 'role', 'assigned_sections')
INSTRUCTOR_EXPECTED_HEADERS = ('instructor id', 'first name', 'last name', 'email', 'role', 'assigned sections')
MAX_IMPORT_ROWS = 1000
MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024
CUSTOM_STUDENT_TEMPLATE_HEADERS = (
    'student_id (required)', 'first_name (required)', 'last_name (required)',
    'email (required)', 'section (optional)',
)
CUSTOM_INSTRUCTOR_TEMPLATE_HEADERS = (
    'instructor_id (required)', 'first_name (required)', 'last_name (required)',
    'email (required)', 'sections (optional)',
)


def _cell_text(value):
    if value is None:
        return ''
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


def _row_error(row_number, column, message):
    return {'row': row_number, 'column': column, 'message': message}


def _normalized_header(value):
    header = ' '.join(_cell_text(value).casefold().replace('_', ' ').split())
    return re.sub(r'\s*\([^)]*\)\s*$', '', header).strip()


def _is_custom_import_header(values, expected_role):
    headers = {_normalized_header(value) for value in values if _normalized_header(value)}
    required = {'first name', 'last name', 'email'}
    if expected_role == User.RoleChoices.STUDENT:
        required.add('student id')
    elif not headers.intersection({'instructor id', 'employee id', 'instructor/employee id', 'instructor employee id'}):
        return False
    return required.issubset(headers)


def _read_tabular_file(uploaded_file, expected_role):
    filename = str(getattr(uploaded_file, 'name', '') or '').lower()
    extension = filename.rsplit('.', 1)[-1] if '.' in filename else ''
    if extension not in ('xlsx', 'csv'):
        return [], [_row_error(1, 'file', 'Upload a .xlsx or .csv file.')]
    if getattr(uploaded_file, 'size', 0) > MAX_IMPORT_FILE_BYTES:
        return [], [_row_error(1, 'file', 'The file must be 10 MB or smaller.')]

    if extension == 'xlsx':
        try:
            workbook = load_workbook(uploaded_file, read_only=True, data_only=True)
        except (InvalidFileException, OSError, ValueError, zipfile.BadZipFile):
            return [], [_row_error(1, 'file', 'The uploaded file is not a readable .xlsx workbook.')]
        try:
            iterator = workbook.active.iter_rows(values_only=True)
            header_row = None
            header_row_number = None
            for candidate_row_number, candidate in enumerate(iterator, start=1):
                if _is_custom_import_header(candidate, expected_role):
                    header_row = candidate
                    header_row_number = candidate_row_number
                    break
                if candidate_row_number >= 20:
                    break
            values = list(iterator) if header_row is not None else []
        finally:
            workbook.close()
    else:
        try:
            raw_bytes = uploaded_file.read()
            text = raw_bytes.decode('utf-8-sig')
            if '\x00' in text:
                raise UnicodeDecodeError('utf-8', raw_bytes, 0, 1, 'NUL byte in CSV')
            values = list(csv.reader(io.StringIO(text, newline='')))
            header_row = values[0] if values else None
            header_row_number = 1 if header_row else None
            values = values[1:] if values else []
        except (UnicodeDecodeError, csv.Error):
            return [], [_row_error(1, 'file', 'The CSV file must contain valid UTF-8 comma-separated text.')]

    if not header_row:
        return [], [_row_error(1, 'header', 'The file is empty or has no recognized header in its first 20 rows.')]

    header_names = [_normalized_header(value) for value in header_row]
    allowed = {
        User.RoleChoices.STUDENT: {
            'student id': 'student_id', 'first name': 'first_name', 'last name': 'last_name',
            'email': 'email', 'contact number': 'contact_number', 'section': 'section',
            'subject': 'subject', 'subject code': 'subject', 'program': 'program',
            'year level': 'year_level', 'academic year': 'academic_year',
            'account status': 'account_status',
        },
        User.RoleChoices.INSTRUCTOR: {
            'instructor id': 'instructor_id', 'employee id': 'instructor_id',
            'instructor employee id': 'instructor_id', 'instructor/employee id': 'instructor_id',
            'first name': 'first_name',
            'last name': 'last_name', 'email': 'email', 'contact number': 'contact_number',
            'assigned sections': 'assigned_sections', 'assigned section': 'assigned_sections',
            'sections': 'assigned_sections', 'account status': 'account_status',
        },
    }[expected_role]
    required = {'student_id', 'first_name', 'last_name', 'email'} if expected_role == User.RoleChoices.STUDENT else {'instructor_id', 'first_name', 'last_name', 'email'}
    mapped_headers = []
    errors = []
    for index, header in enumerate(header_names):
        field = allowed.get(header)
        if not field:
            errors.append(_row_error(1, 'header', f'Unsupported column: {header or f"column {index + 1}"}.' ))
        mapped_headers.append(field)
    field_counts = {field: mapped_headers.count(field) for field in set(mapped_headers) if field}
    duplicated = [field for field, count in field_counts.items() if count > 1]
    for field in duplicated:
        errors.append(_row_error(1, 'header', f'Duplicate column for {field}.' ))
    for field in required - set(mapped_headers):
        errors.append(_row_error(1, 'header', f'Missing required column: {field.replace("_", " ")}.' ))
    if errors:
        return [], errors

    rows = []
    for row_number, row_values in enumerate(values, start=(header_row_number or 1) + 1):
        if not any(_cell_text(value) for value in row_values):
            continue
        if len(rows) >= MAX_IMPORT_ROWS:
            errors.append(_row_error(row_number, 'row', f'Files may contain at most {MAX_IMPORT_ROWS} rows.'))
            break
        row = {field: _cell_text(row_values[index] if index < len(row_values) else None) for index, field in enumerate(mapped_headers)}
        row['row_number'] = row_number
        row['role'] = expected_role
        rows.append(row)
    if not rows and not errors:
        errors.append(_row_error(2, 'row', 'The file contains no user rows.'))
    return rows, errors


def read_custom_student_import(uploaded_file):
    return _read_tabular_file(uploaded_file, User.RoleChoices.STUDENT)


def read_custom_instructor_import(uploaded_file):
    return _read_tabular_file(uploaded_file, User.RoleChoices.INSTRUCTOR)


def build_custom_import_template(role, file_format='xlsx'):
    is_student = role == User.RoleChoices.STUDENT
    headers = CUSTOM_STUDENT_TEMPLATE_HEADERS if is_student else CUSTOM_INSTRUCTOR_TEMPLATE_HEADERS
    csv_headers = (
        ('student_id', 'first_name', 'last_name', 'email', 'section')
        if is_student
        else ('instructor_id', 'first_name', 'last_name', 'email', 'sections')
    )
    if file_format == 'csv':
        output = io.StringIO(newline='')
        csv.writer(output).writerow(csv_headers)
        return output.getvalue().encode('utf-8-sig'), 'text/csv', f'{role}-import-template.csv'
    output = io.BytesIO()
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = 'Student Import' if is_student else 'Instructor Import'
    column_count = len(headers)
    navy_fill = PatternFill('solid', fgColor='082B53')
    yellow_fill = PatternFill('solid', fgColor='FFBE0B')
    light_blue_fill = PatternFill('solid', fgColor='EAF2FB')
    thin_border = Border(bottom=Side(style='thin', color='D8E2ED'))
    title = 'TapTrack Student Import Template' if is_student else 'TapTrack Instructor Import Template'
    instructions = (
        'Required: student_id, first_name, last_name, email.'
        if is_student else 'Required: instructor_id, first_name, last_name, email.'
    )
    optional = (
        'Optional: section. Leave blank for no section; use an existing section name or subject code.'
        if is_student else 'Optional: sections. Leave blank for no assigned sections; values must match existing sections.'
    )
    example = (
        'One student may have one section. Unknown sections are rejected; they are never created automatically.'
        if is_student else 'Separate multiple section names or subject codes with semicolons, e.g. BSIT-1A;BSIT-1B;BSIT-2A.'
    )
    for row_number in range(1, 6):
        worksheet.merge_cells(start_row=row_number, start_column=1, end_row=row_number, end_column=column_count)
    worksheet['A1'] = title
    worksheet['A2'] = 'Use one row per new account. Existing users are not overwritten.'
    worksheet['A3'] = instructions
    worksheet['A4'] = optional
    worksheet['A5'] = example
    worksheet['A1'].fill = navy_fill
    worksheet['A1'].font = Font(name='Aptos Display', size=18, bold=True, color='FFFFFF')
    worksheet['A1'].alignment = Alignment(vertical='center')
    for row_number in (2, 3, 4, 5):
        cell = worksheet.cell(row=row_number, column=1)
        cell.fill = light_blue_fill if row_number % 2 == 0 else PatternFill('solid', fgColor='FFFFFF')
        cell.font = Font(name='Aptos', size=10, bold=row_number in (3, 4), color='082B53')
        cell.alignment = Alignment(vertical='center', wrap_text=True)
    worksheet.row_dimensions[1].height = 34
    worksheet.row_dimensions[2].height = 22
    worksheet.row_dimensions[3].height = 22
    worksheet.row_dimensions[4].height = 30
    worksheet.row_dimensions[5].height = 30
    worksheet.row_dimensions[6].height = 8
    header_row = 7
    for column_number, header in enumerate(headers, start=1):
        cell = worksheet.cell(row=header_row, column=column_number, value=header)
        cell.fill = navy_fill
        cell.font = Font(name='Aptos', size=10, bold=True, color='FFFFFF')
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        cell.border = Border(bottom=Side(style='medium', color='FFBE0B'))
        worksheet.column_dimensions[cell.column_letter].width = max(18, min(34, len(header) + 4))
    worksheet.row_dimensions[header_row].height = 32
    worksheet.freeze_panes = f'A{header_row + 1}'
    worksheet.auto_filter.ref = f'A{header_row}:{worksheet.cell(row=header_row, column=column_count).column_letter}{header_row}'
    worksheet.sheet_view.showGridLines = False
    worksheet.page_setup.orientation = 'landscape'
    worksheet.page_setup.fitToWidth = 1
    worksheet.page_setup.fitToHeight = 0
    worksheet.sheet_properties.pageSetUpPr.fitToPage = True
    worksheet.print_title_rows = f'{header_row}:{header_row}'
    worksheet.page_margins.left = 0.25
    worksheet.page_margins.right = 0.25
    workbook.save(output)
    return (
        output.getvalue(),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        f'{role}-import-template.xlsx',
    )


def build_custom_import_preview(prepared, errors, role):
    errors_by_row = defaultdict(list)
    for error in errors:
        row_number = error.get('row')
        if isinstance(row_number, int) or str(row_number).isdigit():
            errors_by_row[int(row_number)].append(error)

    sections_by_id = {
        section.pk: section
        for section in Section.objects.all().only('pk', 'section_name', 'subject_code')
    }
    rows = []
    prepared_rows = set()
    for item in prepared:
        row_number = int(item.get('row_number') or 0)
        prepared_rows.add(row_number)
        row_errors = errors_by_row.get(row_number, [])
        if role == User.RoleChoices.STUDENT:
            section = sections_by_id.get(item.get('section_id'))
            assigned_sections = [section.section_name] if section else []
            identifier = item.get('student_id', '')
        else:
            assigned_sections = [
                sections_by_id[section_id].section_name
                for section_id in item.get('section_ids', [])
                if section_id in sections_by_id
            ]
            identifier = item.get('instructor_id', '')
        duplicate = any(
            'duplicate' in error['message'].casefold()
            or 'already exists' in error['message'].casefold()
            or 'already in use' in error['message'].casefold()
            for error in row_errors
        )
        rows.append({
            'row_number': row_number,
            'file': item.get('source_file', ''),
            'source_row_number': item.get('source_row_number', row_number),
            'full_name': f"{item.get('first_name', '')} {item.get('last_name', '')}".strip(),
            'identifier': identifier,
            'sections': assigned_sections,
            'validation_status': 'Duplicate' if duplicate else 'Invalid' if row_errors else 'Valid',
            'duplicate': duplicate,
            'error_message': '; '.join(error['message'] for error in row_errors),
        })

    for row_number, row_errors in errors_by_row.items():
        if row_number not in prepared_rows:
            duplicate = any('duplicate' in error['message'].casefold() for error in row_errors)
            rows.append({
                'row_number': row_number,
                'full_name': '',
                'identifier': '',
                'sections': [],
                'validation_status': 'Duplicate' if duplicate else 'Invalid',
                'duplicate': duplicate,
                'error_message': '; '.join(error['message'] for error in row_errors),
            })
    rows.sort(key=lambda item: item['row_number'])
    valid_count = sum(row['validation_status'] == 'Valid' for row in rows)
    invalid_count = sum(row['validation_status'] == 'Invalid' for row in rows)
    duplicate_count = sum(row['validation_status'] == 'Duplicate' for row in rows)
    return {
        'rows': rows,
        'total_rows': len(rows),
        'valid_rows': valid_count,
        'invalid_rows': invalid_count,
        'duplicate_rows': duplicate_count,
        'errors': errors,
    }


def _parse_active_status(value, row_number, errors):
    normalized = _cell_text(value).casefold()
    if not normalized:
        return True
    if normalized in ('active', 'true', 'yes', '1'):
        return True
    if normalized in ('inactive', 'false', 'no', '0'):
        return False
    errors.append(_row_error(row_number, 'account_status', 'Use Active or Inactive.'))
    return True


def read_student_workbook(uploaded_file):
    try:
        workbook = load_workbook(uploaded_file, read_only=True, data_only=True)
    except (InvalidFileException, OSError, ValueError, zipfile.BadZipFile):
        return [], [_row_error(1, 'file', 'The uploaded file is not a readable .xlsx workbook.')]

    try:
        worksheet = workbook.active
        iterator = worksheet.iter_rows(values_only=True)
        header_row = next(iterator, None)
        if not header_row:
            return [], [_row_error(1, 'header', 'The workbook is empty.')]

        headers = [_cell_text(value).casefold().replace('_', ' ') for value in header_row]
        while headers and not headers[-1]:
            headers.pop()
        normalized_headers = tuple(' '.join(header.split()) for header in headers)
        if normalized_headers != EXPECTED_HEADERS:
            expected = ' | '.join(('Student ID', 'First Name', 'Last Name', 'Email', 'Role', 'Subject'))
            return [], [_row_error(
                1,
                'header',
                f'Expected columns in this exact order: {expected}. Download the current template; older templates are not supported.',
            )]

        errors = []
        rows = []
        for row_number, values in enumerate(iterator, start=2):
            if not any(_cell_text(value) for value in values):
                continue
            if any(_cell_text(value) for value in values[len(IMPORT_COLUMNS):]):
                errors.append(_row_error(row_number, 'row', 'Unexpected values found after the Subject column.'))
                continue
            if len(rows) >= MAX_IMPORT_ROWS:
                errors.append(_row_error(row_number, 'row', f'Files may contain at most {MAX_IMPORT_ROWS} student rows.'))
                break
            row = {
                column: _cell_text(values[index] if index < len(values) else None)
                for index, column in enumerate(IMPORT_COLUMNS)
            }
            row['row_number'] = row_number
            rows.append(row)

        if not rows and not errors:
            errors.append(_row_error(2, 'row', 'The workbook contains no student rows.'))
        return rows, errors
    finally:
        workbook.close()


def username_for_student_id(student_id):
    safe_id = re.sub(r'[^A-Za-z0-9@.+_-]+', '_', student_id).strip('_')
    return f'student_{safe_id or "record"}'


def build_student(row):
    section = Section.objects.get(pk=row['section_id']) if row['section_id'] else None
    user = User(
        username=row['username'],
        first_name=row['first_name'],
        last_name=row['last_name'],
        student_id=row['student_id'],
        email=row['email'],
        contact_number=row.get('contact_number', ''),
        role=User.RoleChoices.STUDENT,
        section=section,
        nfc_uid=None,
        is_active=row['active'],
        is_staff=False,
        is_superuser=False,
    )
    user.set_unusable_password()
    return user


def validate_student_rows(rows):
    errors = []
    prepared = []
    seen = {key: {} for key in ('student_id', 'email', 'username')}
    section_lookup = {}
    section_by_id = {}
    for section in Section.objects.all().only('pk', 'subject_code', 'section_name', 'program', 'year_level', 'academic_year'):
        section_by_id[section.pk] = section
        for value in (section.subject_code, section.section_name):
            key = value.strip().casefold()
            if key and section.pk not in section_lookup.setdefault(key, []):
                section_lookup[key].append(section.pk)

    for source in rows:
        row_number = int(source.get('row_number') or 0)
        row_errors = []
        student_id = _cell_text(source.get('student_id'))
        first_name = _cell_text(source.get('first_name'))
        last_name = _cell_text(source.get('last_name'))
        email = _cell_text(source.get('email'))
        section_value = _cell_text(source.get('section') if 'section' in source else source.get('subject'))
        section_error_column = 'section' if 'section' in source else 'subject'
        contact_number = _cell_text(source.get('contact_number'))
        username = _cell_text(source.get('username')) or username_for_student_id(student_id)
        role = _cell_text(source.get('role')).casefold()
        active = _parse_active_status(source.get('account_status'), row_number, row_errors)

        if role and role != User.RoleChoices.STUDENT:
            row_errors.append(_row_error(row_number, 'role', 'Only the student role can be imported here.'))

        for column, value in (
            ('student_id', student_id),
            ('first_name', first_name),
            ('last_name', last_name),
            ('email', email),
            ('role', role),
        ):
            if not value:
                row_errors.append(_row_error(row_number, column, f'{column} is required.'))

        if student_id and len(student_id) > User._meta.get_field('student_id').max_length:
            row_errors.append(_row_error(row_number, 'student_id', 'Student ID is too long.'))
        if email:
            try:
                validate_email(email)
            except ValidationError:
                row_errors.append(_row_error(row_number, 'email', 'Enter a valid email address.'))
        if contact_number and len(contact_number) > User._meta.get_field('contact_number').max_length:
            row_errors.append(_row_error(row_number, 'contact_number', 'Contact number is too long.'))

        for column, value, normalized in (
            ('student_id', student_id, student_id.casefold()),
            ('email', email, email.casefold()),
            ('username', username, username.casefold()),
        ):
            if not value:
                continue
            if normalized in seen[column]:
                row_errors.append(_row_error(row_number, column, f'Duplicate {column} in this spreadsheet (first seen on row {seen[column][normalized]}).'))
            else:
                seen[column][normalized] = row_number

        if student_id and User.objects.filter(student_id__iexact=student_id).exists():
            row_errors.append(_row_error(row_number, 'student_id', 'A student with this ID already exists; imports do not overwrite records.'))
        if email and User.objects.filter(email__iexact=email).exists():
            row_errors.append(_row_error(row_number, 'email', 'This email address is already in use.'))
        if username and User.objects.filter(username__iexact=username).exists():
            row_errors.append(_row_error(row_number, 'username', 'This username is already in use.'))

        section_id = None
        if section_value:
            matches = section_lookup.get(section_value.casefold(), [])
            if not matches:
                row_errors.append(_row_error(row_number, section_error_column, f'No existing Section matches "{section_value}".'))
            elif len(matches) > 1:
                row_errors.append(_row_error(row_number, section_error_column, f'More than one existing Section matches "{section_value}"; resolve the ambiguity first.'))
            else:
                section_id = matches[0]
                section = section_by_id[section_id]
                for field in ('program', 'year_level', 'academic_year'):
                    supplied = _cell_text(source.get(field))
                    if supplied and supplied.casefold() != str(getattr(section, field) or '').strip().casefold():
                        row_errors.append(_row_error(row_number, field, f'This value does not match the selected Section ({getattr(section, field)}).'))
        elif any(_cell_text(source.get(field)) for field in ('program', 'year_level', 'academic_year')):
            row_errors.append(_row_error(row_number, 'section', 'Select a Section before supplying its program or year details.'))

        candidate = {
            'row_number': row_number,
            'source_file': source.get('source_file', ''),
            'source_row_number': source.get('source_row_number', row_number),
            'student_id': student_id,
            'first_name': first_name,
            'last_name': last_name,
            'email': email,
            'username': username,
            'subject': section_value,
            'contact_number': contact_number,
            'program': _cell_text(source.get('program')),
            'year_level': _cell_text(source.get('year_level')),
            'academic_year': _cell_text(source.get('academic_year')),
            'role': role,
            'section_id': section_id,
            'active': active,
        }

        if not row_errors:
            try:
                build_student(candidate).full_clean()
            except ValidationError as error:
                if hasattr(error, 'message_dict'):
                    for field, messages in error.message_dict.items():
                        for message in messages:
                            row_errors.append(_row_error(row_number, field, str(message)))
                else:
                    row_errors.append(_row_error(row_number, 'row', '; '.join(error.messages)))

        errors.extend(row_errors)
        prepared.append(candidate)

    return prepared, errors


def read_instructor_workbook(uploaded_file):
    try:
        workbook = load_workbook(uploaded_file, read_only=True, data_only=True)
    except (InvalidFileException, OSError, ValueError, zipfile.BadZipFile):
        return [], [_row_error(1, 'file', 'The uploaded file is not a readable .xlsx workbook.')]

    try:
        worksheet = workbook.active
        iterator = worksheet.iter_rows(values_only=True)
        header_row = next(iterator, None)
        if not header_row:
            return [], [_row_error(1, 'header', 'The workbook is empty.')]

        headers = [_cell_text(value).casefold().replace('_', ' ') for value in header_row]
        while headers and not headers[-1]:
            headers.pop()
        normalized_headers = tuple(' '.join(header.split()) for header in headers)
        if normalized_headers not in {
            INSTRUCTOR_EXPECTED_HEADERS,
            ('instructor id', 'first name', 'last name', 'email', 'role', 'subject'),
            ('instructor id', 'first name', 'last name', 'email', 'role', 'assigned section'),
            ('instructor id', 'first name', 'last name', 'email', 'role', 'section')
        }:
            expected = ' | '.join(('Instructor ID', 'First Name', 'Last Name', 'Email', 'Role', 'Assigned Sections'))
            return [], [_row_error(
                1,
                'header',
                f'Expected columns in this exact order: {expected}. Download the current template; older templates are not supported.',
            )]

        errors = []
        rows = []
        for row_number, values in enumerate(iterator, start=2):
            if not any(_cell_text(value) for value in values):
                continue
            if any(_cell_text(value) for value in values[len(INSTRUCTOR_IMPORT_COLUMNS):]):
                errors.append(_row_error(row_number, 'row', 'Unexpected values found after the Assigned Sections column.'))
                continue
            if len(rows) >= MAX_IMPORT_ROWS:
                errors.append(_row_error(row_number, 'row', f'Files may contain at most {MAX_IMPORT_ROWS} instructor rows.'))
                break
            row = {
                column: _cell_text(values[index] if index < len(values) else None)
                for index, column in enumerate(INSTRUCTOR_IMPORT_COLUMNS)
            }
            row['row_number'] = row_number
            rows.append(row)

        if not rows and not errors:
            errors.append(_row_error(2, 'row', 'The workbook contains no instructor rows.'))
        return rows, errors
    finally:
        workbook.close()


def username_for_instructor_id(instructor_id):
    safe_id = re.sub(r'[^A-Za-z0-9@.+_-]+', '_', instructor_id).strip('_')
    return f'instructor_{safe_id or "record"}'


def build_instructor(row):
    section_subjects = []
    raw_sections = row.get('assigned_sections') or row.get('subject') or ''
    if isinstance(raw_sections, str):
        section_subjects = [part.strip() for part in re.split(r'[;,|\n]+', raw_sections) if part.strip()]
    elif isinstance(raw_sections, (list, tuple, set)):
        section_subjects = [str(item).strip() for item in raw_sections if str(item).strip()]

    section_ids = []
    for value in section_subjects:
        matches = Section.objects.filter(models.Q(subject_code__iexact=value) | models.Q(section_name__iexact=value)).values_list('pk', flat=True)
        if matches:
            section_ids.extend(matches)

    user = User(
        username=row['username'],
        first_name=row['first_name'],
        last_name=row['last_name'],
        instructor_id=row['instructor_id'],
        email=row['email'],
        contact_number=row.get('contact_number', ''),
        role=User.RoleChoices.INSTRUCTOR,
        nfc_uid=None,
        is_active=row.get('active', True),
        is_staff=False,
        is_superuser=False,
    )
    user.set_unusable_password()
    user._allow_unassigned_nfc_for_import = True
    user._pending_section_ids = list(dict.fromkeys(section_ids))
    return user


def validate_instructor_rows(rows):
    errors = []
    prepared = []
    seen = {key: {} for key in ('instructor_id', 'email', 'username')}
    section_lookup = {}
    for section in Section.objects.all().only('pk', 'subject_code', 'section_name'):
        for value in (section.subject_code, section.section_name):
            key = value.strip().casefold()
            if key and section.pk not in section_lookup.setdefault(key, []):
                section_lookup[key].append(section.pk)

    for source in rows:
        row_number = int(source.get('row_number') or 0)
        row_errors = []
        instructor_id = _cell_text(source.get('instructor_id'))
        first_name = _cell_text(source.get('first_name'))
        last_name = _cell_text(source.get('last_name'))
        email = _cell_text(source.get('email'))
        contact_number = _cell_text(source.get('contact_number'))
        assigned_text = _cell_text(source.get('assigned_sections') or source.get('subject') or '')
        username = _cell_text(source.get('username')) or username_for_instructor_id(instructor_id)
        role = _cell_text(source.get('role')).casefold()
        active = _parse_active_status(source.get('account_status'), row_number, row_errors)

        if role and role != User.RoleChoices.INSTRUCTOR:
            row_errors.append(_row_error(row_number, 'role', 'Only the instructor role can be imported here.'))

        for column, value in (
            ('instructor_id', instructor_id),
            ('first_name', first_name),
            ('last_name', last_name),
            ('email', email),
            ('role', role),
        ):
            if not value:
                row_errors.append(_row_error(row_number, column, f'{column} is required.'))

        if instructor_id and len(instructor_id) > User._meta.get_field('instructor_id').max_length:
            row_errors.append(_row_error(row_number, 'instructor_id', 'Instructor ID is too long.'))
        if email:
            try:
                validate_email(email)
            except ValidationError:
                row_errors.append(_row_error(row_number, 'email', 'Enter a valid email address.'))
        if contact_number and len(contact_number) > User._meta.get_field('contact_number').max_length:
            row_errors.append(_row_error(row_number, 'contact_number', 'Contact number is too long.'))

        for column, value, normalized in (
            ('instructor_id', instructor_id, instructor_id.casefold()),
            ('email', email, email.casefold()),
            ('username', username, username.casefold()),
        ):
            if not value:
                continue
            if normalized in seen[column]:
                row_errors.append(_row_error(row_number, column, f'Duplicate {column} in this spreadsheet (first seen on row {seen[column][normalized]}).'))
            else:
                seen[column][normalized] = row_number

        if instructor_id and User.objects.filter(instructor_id__iexact=instructor_id).exists():
            row_errors.append(_row_error(row_number, 'instructor_id', 'An instructor with this ID already exists; imports do not overwrite records.'))
        if email and User.objects.filter(email__iexact=email).exists():
            row_errors.append(_row_error(row_number, 'email', 'This email address is already in use.'))
        if username and User.objects.filter(username__iexact=username).exists():
            row_errors.append(_row_error(row_number, 'username', 'This username is already in use.'))

        section_ids = []
        if assigned_text:
            direct_values = [part.strip() for part in re.split(r'[;,|\n]+', assigned_text) if part.strip()]
            for value in direct_values:
                matches = section_lookup.get(value.casefold(), [])
                if not matches:
                    row_errors.append(_row_error(row_number, 'assigned_sections', f'No existing Section matches "{value}".'))
                elif len(matches) > 1:
                    row_errors.append(_row_error(row_number, 'assigned_sections', f'More than one existing Section matches "{value}"; resolve the ambiguity first.'))
                else:
                    match = matches[0]
                    if match not in section_ids:
                        section_ids.append(match)

        candidate = {
            'row_number': row_number,
            'source_file': source.get('source_file', ''),
            'source_row_number': source.get('source_row_number', row_number),
            'instructor_id': instructor_id,
            'first_name': first_name,
            'last_name': last_name,
            'email': email,
            'contact_number': contact_number,
            'username': username,
            'assigned_sections': assigned_text,
            'role': role,
            'section_ids': section_ids,
            'active': active,
        }

        if not row_errors:
            try:
                build_instructor(candidate).full_clean()
            except ValidationError as error:
                if hasattr(error, 'message_dict'):
                    for field, messages in error.message_dict.items():
                        for message in messages:
                            row_errors.append(_row_error(row_number, field, str(message)))
                else:
                    row_errors.append(_row_error(row_number, 'row', '; '.join(error.messages)))

        errors.extend(row_errors)
        prepared.append(candidate)

    return prepared, errors