from datetime import timedelta
from io import BytesIO
from zoneinfo import ZoneInfo

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from openpyxl import load_workbook
from rest_framework.test import APIClient

from .models import AccessLog, AccessLogPhoto, CabinetSession, Section, User


class AdminExcelExportTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            username='excel-export-admin',
            email='excel-export-admin@example.com',
            password='TestAdminPassword-123',
            nfc_uid='EXCEL-EXPORT-ADMIN',
        )
        self.section = Section.objects.create(
            section_name='Export Section',
            subject_code='EXPORT-101',
        )
        self.student = User.objects.create_user(
            username='excel-export-student',
            email='excel-export-student@example.com',
            password='TestStudentPassword-123',
            role=User.RoleChoices.STUDENT,
            student_id='EXPORT-STUDENT-1',
            first_name='=HYPERLINK("https://example.invalid")',
            last_name='Example',
            section=self.section,
            nfc_uid='PRIVATE-EXPORT-UID',
        )
        self.other_student = User.objects.create_user(
            username='excel-export-other',
            email='excel-export-other@example.com',
            password='TestStudentPassword-123',
            role=User.RoleChoices.STUDENT,
            student_id='EXPORT-STUDENT-2',
            first_name='Other',
        )
        self.client.force_authenticate(user=self.admin)

    @staticmethod
    def workbook_from_response(response):
        content = b''.join(response.streaming_content) if response.streaming else response.content
        response.close()
        return load_workbook(BytesIO(content), data_only=True)

    def test_users_export_is_a_styled_selected_xlsx_without_credentials(self):
        response = self.client.post('/api/users/export-excel/', {'ids': [self.student.pk]}, format='json')

        self.assertEqual(response.status_code, 200, getattr(response, 'data', None))
        self.assertIn('users-management-report.xlsx', response['Content-Disposition'])
        workbook = self.workbook_from_response(response)
        sheet = workbook.active

        self.assertEqual(sheet['A1'].value, 'TapTrack')
        self.assertEqual(sheet['A2'].value, 'Users Management Report')
        self.assertIn('Total exported records: 1', sheet['A5'].value)
        self.assertRegex(sheet['A4'].value, r'^Generated \(Asia/Manila\): .* PHT$')
        self.assertEqual(sheet['A1'].fill.fgColor.rgb[-6:], '082B53')
        self.assertEqual(sheet['A3'].fill.fgColor.rgb[-6:], 'FFBE0B')
        self.assertEqual(sheet.freeze_panes, 'A8')
        self.assertEqual(sheet.auto_filter.ref, 'A7:H8')
        self.assertEqual(sheet['A7'].value, 'Full Name')
        self.assertEqual(sheet['A8'].value, "'=HYPERLINK(\"https://example.invalid\") Example")
        self.assertEqual(sheet['B8'].value, self.student.username)
        self.assertEqual(sheet['C8'].value, self.student.student_id)
        self.assertEqual(sheet['E8'].value, self.student.email)
        self.assertEqual(sheet['G8'].value, 'Export Section')
        self.assertEqual(sheet['H8'].value, 'Active')
        self.assertNotIn('PRIVATE-EXPORT-UID', [cell.value for row in sheet.iter_rows() for cell in row])
        self.assertNotIn(self.student.password, [cell.value for row in sheet.iter_rows() for cell in row])
        self.assertFalse(any('password' in str(cell.value).lower() for row in sheet.iter_rows() for cell in row))
        self.assertEqual(sheet.page_setup.orientation, 'landscape')
        self.assertEqual(sheet.sheet_properties.pageSetUpPr.fitToPage, True)

    def test_access_log_export_uses_selected_records_local_dates_and_result_styles(self):
        opened_at = timezone.now() - timedelta(minutes=13)
        session = CabinetSession.objects.create(station='Station A', status=CabinetSession.StatusChoices.CLOSED)
        session.opened_at = opened_at
        session.closed_at = opened_at + timedelta(minutes=13)
        session.save(update_fields=['opened_at', 'closed_at'])
        success_log = AccessLog.objects.create(
            user=self.student,
            cabinet_session=session,
            status=AccessLog.AccessStatusChoices.SUCCESS,
            action=AccessLog.AccessActionChoices.OPEN,
            station='Station A',
            cabinet_name='Cabinet Alpha',
            reason='Cabinet unlocked successfully',
        )
        failed_log = AccessLog.objects.create(
            user=self.other_student,
            status=AccessLog.AccessStatusChoices.REJECTED,
            action=AccessLog.AccessActionChoices.SCAN,
            station='Station B',
            cabinet_name='Cabinet Beta',
        )
        failed_log.access_time = timezone.now() - timedelta(minutes=5)
        failed_log.save(update_fields=['access_time'])
        AccessLogPhoto.objects.create(
            access_log=success_log,
            capture_status=AccessLogPhoto.CaptureStatusChoices.SUCCESS,
        )

        response = self.client.post('/api/access-logs/export-excel/', {
            'ids': [success_log.pk, failed_log.pk],
            'scope': 'selected',
        }, format='json')

        self.assertEqual(response.status_code, 200, getattr(response, 'data', None))
        workbook = self.workbook_from_response(response)
        sheet = workbook.active
        self.assertEqual(sheet['A2'].value, 'Access History Report')
        self.assertIn('Total exported records: 2', sheet['A5'].value)
        self.assertIn('Selected records', sheet['A5'].value)
        self.assertRegex(sheet['A4'].value, r'^Generated \(Asia/Manila\): .* PHT$')
        self.assertEqual(sheet['A7'].value, 'Date and Time')
        expected_local_time = timezone.localtime(success_log.access_time, ZoneInfo('Asia/Manila')).replace(tzinfo=None)
        delta = abs((sheet['A8'].value - expected_local_time).total_seconds())
        self.assertLessEqual(delta, 0.001)
        self.assertEqual(sheet['C8'].value, 'student')
        self.assertEqual(sheet['D8'].value, 'Export Section')
        self.assertEqual(sheet['F8'].value, 'Cabinet Alpha')
        self.assertEqual(sheet['G8'].value, 'Cabinet Unlock')
        self.assertEqual(sheet['I8'].value, 'Success')
        self.assertEqual(sheet['J8'].value, 'success')
        self.assertEqual(sheet['K8'].value, '13 min')
        self.assertEqual(sheet['I8'].font.color.rgb[-6:], '166534')
        self.assertEqual(sheet['I9'].value, 'Rejected')
        self.assertEqual(sheet['I9'].font.color.rgb[-6:], 'B91C1C')
        self.assertEqual(sheet['J9'].value, None)
        self.assertEqual(sheet.freeze_panes, 'A8')
        self.assertEqual(sheet.auto_filter.ref, 'A7:K9')
        self.assertEqual(sheet.page_setup.orientation, 'landscape')

    def test_excel_exports_remain_admin_only(self):
        self.client.force_authenticate(user=self.student)

        users_response = self.client.post('/api/users/export-excel/', {'ids': [self.student.pk]}, format='json')
        logs_response = self.client.post('/api/access-logs/export-excel/', {'ids': []}, format='json')

        self.assertEqual(users_response.status_code, 403)
        self.assertEqual(logs_response.status_code, 403)