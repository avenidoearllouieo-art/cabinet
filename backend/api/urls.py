from rest_framework.routers import DefaultRouter
from django.urls import path, include
from rest_framework_simplejwt.views import TokenRefreshView
from .views import (
    SectionViewSet,
    UserViewSet,
    ActivityViewSet,
    SubmissionViewSet,
    AccessLogViewSet,
    CabinetSessionViewSet,
    CabinetEventViewSet,
    ActivityDiscussionViewSet,
    ActivityAnnouncementViewSet,
    NotificationViewSet,
    VerifyNFCView,
    AccessLogPhotoUploadView,
    AccessLogPhotoStatusView,
    AccessLogPhotoImageView,
    CabinetWorkflowView,
    NFCEnrollmentValidationView,
    NFCEnrollmentCancellationView,
    NFCEnrollmentRegistrationView,
    CabinetRegistrationView,
    DashboardStatisticsView,
    CustomTokenObtainPairView,
    PasswordResetRequestView,
    PasswordResetStatusView,
    PasswordResetVerifyNFCView,
    PasswordResetCabinetHandoffView,
    PasswordResetCabinetQueueView,
    PasswordResetCancellationView,
    PasswordResetValidateTokenView,
    PasswordResetConfirmView,
    StudentSubmissionUpload,
    TemporaryUploadViewSet,
    AdminUserImportTemplateView,
    AdminUserImportPreviewView,
    AdminUserImportConfirmView,
    AcademicFilePreviewAuthorizeView,
    AcademicFilePreviewContentView,
    StudentMultipartUploadStartView,
    StudentMultipartUploadPartView,
    StudentMultipartUploadCompleteView,
    StudentMultipartUploadAbortView,
)

router = DefaultRouter()
router.register(r'sections', SectionViewSet, basename='section')
router.register(r'users', UserViewSet, basename='user')
router.register(r'activities', ActivityViewSet, basename='activity')
router.register(r'submissions', SubmissionViewSet, basename='submission')
router.register(r'access-logs', AccessLogViewSet, basename='accesslog')
router.register(r'cabinet-sessions', CabinetSessionViewSet, basename='cabinetsession')
router.register(r'cabinet-events', CabinetEventViewSet, basename='cabinetevent')
router.register(r'notifications', NotificationViewSet, basename='notification')
router.register(r'temp-uploads', TemporaryUploadViewSet, basename='tempupload')
router.register(r'activity-discussions', ActivityDiscussionViewSet, basename='activitydiscussion')
router.register(r'activity-announcements', ActivityAnnouncementViewSet, basename='activityannouncement')

urlpatterns = [
    path('student/multipart-uploads/', StudentMultipartUploadStartView.as_view(), name='student_multipart_upload_start'),
    path('student/multipart-uploads/<uuid:session_id>/parts/<int:part_number>/', StudentMultipartUploadPartView.as_view(), name='student_multipart_upload_part'),
    path('student/multipart-uploads/<uuid:session_id>/complete/', StudentMultipartUploadCompleteView.as_view(), name='student_multipart_upload_complete'),
    path('student/multipart-uploads/<uuid:session_id>/abort/', StudentMultipartUploadAbortView.as_view(), name='student_multipart_upload_abort'),
    path('file-previews/<str:kind>/<int:attachment_id>/authorize/', AcademicFilePreviewAuthorizeView.as_view(), name='academic_file_preview_authorize'),
    path('file-previews/<str:kind>/<int:attachment_id>/content/', AcademicFilePreviewContentView.as_view(), name='academic_file_preview_content'),
    path('users/import/template/', AdminUserImportTemplateView.as_view(), name='admin_user_import_template'),
    path('users/import/preview/', AdminUserImportPreviewView.as_view(), name='admin_user_import_preview'),
    path('users/import/confirm/', AdminUserImportConfirmView.as_view(), name='admin_user_import_confirm'),
    path('', include(router.urls)),
    path('auth/login/', CustomTokenObtainPairView.as_view(), name='auth_login'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='auth_refresh'),
    path('auth/password-reset/request/', PasswordResetRequestView.as_view(), name='password_reset_request'),
    path('auth/password-reset/status/', PasswordResetStatusView.as_view(), name='password_reset_status'),
    path('auth/password-reset/cancel/', PasswordResetCancellationView.as_view(), name='password_reset_cancel'),
    path('auth/password-reset/verify-nfc/', PasswordResetVerifyNFCView.as_view(), name='password_reset_verify_nfc'),
    path('auth/password-reset/cabinet-handoff/', PasswordResetCabinetHandoffView.as_view(), name='password_reset_cabinet_handoff'),
    path('auth/password-reset/cabinet-queue/', PasswordResetCabinetQueueView.as_view(), name='password_reset_cabinet_queue'),
    path('auth/password-reset/validate-token/', PasswordResetValidateTokenView.as_view(), name='password_reset_validate_token'),
    path('auth/password-reset/confirm/', PasswordResetConfirmView.as_view(), name='password_reset_confirm'),
    path('token/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('verify-nfc/', VerifyNFCView.as_view(), name='verify_nfc'),
    path('access-logs/<int:event_id>/photo/', AccessLogPhotoUploadView.as_view(), name='access_log_photo_upload'),
    path('access-logs/<int:event_id>/photo/image/', AccessLogPhotoImageView.as_view(), name='access_log_photo_image'),
    path('access-logs/<int:event_id>/photo-status/', AccessLogPhotoStatusView.as_view(), name='access_log_photo_status'),
    path('cabinet/workflow/', CabinetWorkflowView.as_view(), name='cabinet_workflow'),
    path('cabinet/enrollment/validate/', NFCEnrollmentValidationView.as_view(), name='nfc_enrollment_validate'),
    path('cabinet/enrollment/cancel/', NFCEnrollmentCancellationView.as_view(), name='nfc_enrollment_cancel'),
    path('cabinet/enrollment/cancel/', NFCEnrollmentCancellationView.as_view(), name='nfc_enrollment_cancel'),
    path('cabinet/enrollment/register/', NFCEnrollmentRegistrationView.as_view(), name='nfc_enrollment_register'),
    path('cabinet/register/', CabinetRegistrationView.as_view(), name='cabinet_register'),
    path('dashboard/', DashboardStatisticsView.as_view(), name='dashboard_statistics'),
    path('student/submissions/upload', StudentSubmissionUpload.as_view(), name='student_submission_upload'),
]
