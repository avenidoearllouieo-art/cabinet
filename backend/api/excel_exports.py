from datetime import datetime
from math import floor
from tempfile import SpooledTemporaryFile
from zoneinfo import ZoneInfo

from django.http import FileResponse
from django.utils import timezone
from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from django.utils.cache import patch_cache_control


NAVY = '082B53'
YELLOW = 'FFBE0B'
LIGHT_BLUE = 'EAF2FB'
WHITE = 'FFFFFF'
TEXT = '1F2937'
SUCCESS_TEXT = '166534'
SUCCESS_FILL = 'EAF7EF'
FAILURE_TEXT = 'B91C1C'
FAILURE_FILL = 'FEF2F2'
TIME_ZONE = ZoneInfo('Asia/Manila')
XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


def safe_excel_value(value):
    if not isinstance(value, str):
        return value
    value = ILLEGAL_CHARACTERS_RE.sub('', value)
    stripped = value.lstrip()
    if stripped.startswith(('=', '+', '-', '@', '\t', '\r')):
        return f"'{value}"
    return value


def local_excel_datetime(value):
    if value is None or not isinstance(value, datetime):
        return value
    if timezone.is_aware(value):
        value = timezone.localtime(value, TIME_ZONE)
    return value.replace(tzinfo=None)


def format_duration(seconds):
    if seconds is None:
        return None
    try:
        total_seconds = max(0, floor(float(seconds)))
    except (TypeError, ValueError, OverflowError):
        return None
    if total_seconds < 60:
        return f'{total_seconds} sec'
    total_minutes = total_seconds // 60
    if total_minutes < 60:
        remaining_seconds = total_seconds % 60
        return f'{total_minutes} min{f" {remaining_seconds} sec" if remaining_seconds else ""}'
    total_hours = total_minutes // 60
    if total_hours < 24:
        remaining_minutes = total_minutes % 60
        return f'{total_hours} hr{f" {remaining_minutes} min" if remaining_minutes else ""}'
    days, remaining_hours = divmod(total_hours, 24)
    remaining_minutes = total_minutes % 60
    return f'{days} day{"s" if days != 1 else ""}{f" {remaining_hours} hr" if remaining_hours else ""}{f" {remaining_minutes} min" if remaining_minutes else ""}'


def branded_excel_response(*, report_name, filename, headers, rows, record_count, scope, result_header=None):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = 'Report'
    sheet.sheet_view.showGridLines = False
    workbook.properties.creator = 'TapTrack'
    workbook.properties.title = f'TapTrack - {report_name}'
    last_column = get_column_letter(len(headers))
    navy_fill = PatternFill('solid', fgColor=NAVY)
    yellow_fill = PatternFill('solid', fgColor=YELLOW)
    light_blue_fill = PatternFill('solid', fgColor=LIGHT_BLUE)
    white_fill = PatternFill('solid', fgColor=WHITE)
    thin_border = Border(
        left=Side(style='thin', color='D8E2ED'),
        right=Side(style='thin', color='D8E2ED'),
        top=Side(style='thin', color='D8E2ED'),
        bottom=Side(style='thin', color='D8E2ED'),
    )

    for row_number in (1, 2, 3, 4, 5):
        sheet.merge_cells(start_row=row_number, start_column=1, end_row=row_number, end_column=len(headers))
    sheet['A1'] = 'TapTrack'
    sheet['A2'] = report_name
    generated_at = timezone.localtime(timezone.now(), TIME_ZONE).strftime('%Y-%m-%d %H:%M:%S PHT')
    sheet['A4'] = f'Generated (Asia/Manila): {generated_at}'
    sheet['A5'] = f'Total exported records: {record_count} | Scope: {scope}'
    for cell in sheet[1]:
        cell.fill = navy_fill
    for cell in sheet[2]:
        cell.fill = navy_fill
    for cell in sheet[3]:
        cell.fill = yellow_fill
    for row_number in (4, 5):
        for cell in sheet[row_number]:
            cell.fill = PatternFill('solid', fgColor=WHITE)
            cell.font = Font(name='Aptos', size=10, color=TEXT)
            cell.alignment = Alignment(vertical='center')
    sheet['A1'].font = Font(name='Aptos Display', size=20, bold=True, color=WHITE)
    sheet['A1'].alignment = Alignment(vertical='center')
    sheet['A2'].font = Font(name='Aptos Display', size=13, bold=True, color=WHITE)
    sheet['A2'].alignment = Alignment(vertical='center')
    sheet.row_dimensions[1].height = 34
    sheet.row_dimensions[2].height = 26
    sheet.row_dimensions[3].height = 6
    sheet.row_dimensions[4].height = 20
    sheet.row_dimensions[5].height = 20
    sheet.row_dimensions[6].height = 8

    header_row = 7
    for column_number, header in enumerate(headers, start=1):
        sheet.cell(row=header_row, column=column_number, value=header)
    for cell in sheet[header_row]:
        cell.fill = navy_fill
        cell.font = Font(name='Aptos', size=10, bold=True, color=WHITE)
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        cell.border = thin_border
    sheet.row_dimensions[header_row].height = 32

    widths = [max(12, min(48, len(str(header)) + 3)) for header in headers]
    result_column = headers.index(result_header) + 1 if result_header in headers else None
    for row_number, row in enumerate(rows, start=header_row + 1):
        values = [safe_excel_value(local_excel_datetime(value)) for value in row]
        row_fill = white_fill if row_number % 2 else light_blue_fill
        max_lines = 1
        for column_number, value in enumerate(values, start=1):
            cell = sheet.cell(row=row_number, column=column_number, value=value)
            cell.fill = row_fill
            cell.font = Font(name='Aptos', size=10, color=TEXT)
            cell.alignment = Alignment(vertical='top', wrap_text=True)
            cell.border = thin_border
            if isinstance(value, datetime):
                cell.number_format = 'yyyy-mm-dd hh:mm'
            text = '' if value is None else str(value)
            widths[column_number - 1] = min(48, max(widths[column_number - 1], max((len(line) for line in text.splitlines()), default=0) + 2))
            max_lines = max(max_lines, min(4, text.count('\n') + 1))
            if column_number == result_column:
                if text.casefold() == 'success':
                    cell.fill = PatternFill('solid', fgColor=SUCCESS_FILL)
                    cell.font = Font(name='Aptos', size=10, bold=True, color=SUCCESS_TEXT)
                elif text:
                    cell.fill = PatternFill('solid', fgColor=FAILURE_FILL)
                    cell.font = Font(name='Aptos', size=10, bold=True, color=FAILURE_TEXT)
        sheet.row_dimensions[row_number].height = max(24, min(60, max_lines * 16))

    last_row = sheet.max_row
    sheet.freeze_panes = f'A{header_row + 1}'
    sheet.auto_filter.ref = f'A{header_row}:{last_column}{last_row}'
    for column_number, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(column_number)].width = width
    sheet.page_setup.orientation = 'landscape'
    sheet.page_setup.paperSize = sheet.PAPERSIZE_LETTER
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.print_title_rows = f'{header_row}:{header_row}'
    sheet.page_margins.left = 0.25
    sheet.page_margins.right = 0.25
    sheet.page_margins.top = 0.5
    sheet.page_margins.bottom = 0.5
    sheet.print_area = f'A1:{last_column}{last_row}'

    output = SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode='w+b')
    workbook.save(output)
    workbook.close()
    output.seek(0)
    response = FileResponse(
        output,
        as_attachment=True,
        filename=filename,
        content_type=XLSX_CONTENT_TYPE,
    )
    patch_cache_control(response, private=True, no_store=True)
    return response