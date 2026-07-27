from rest_framework.routers import DefaultRouter
from django.urls import path, include
from rest_framework_simplejwt.views import TokenRefreshView
from .views import (
    SectionViewSet,
    UserViewSet,
    ActivityViewSet,
    SubmissionViewSet,
    AccessLogViewSet,
    CabinetEventViewSet,
    ActivityDiscussionViewSet,
    ActivityAnnouncementViewSet,
    NotificationViewSet,
    VerifyNFCView,
    DashboardStatisticsView,
    CustomTokenObtainPairView,
    StudentSubmissionUpload,
    TemporaryUploadViewSet,
)

router = DefaultRouter()
router.register(r'sections', SectionViewSet, basename='section')
router.register(r'users', UserViewSet, basename='user')
router.register(r'activities', ActivityViewSet, basename='activity')
router.register(r'submissions', SubmissionViewSet, basename='submission')
router.register(r'access-logs', AccessLogViewSet, basename='accesslog')
router.register(r'cabinet-events', CabinetEventViewSet, basename='cabinetevent')
router.register(r'notifications', NotificationViewSet, basename='notification')
router.register(r'temp-uploads', TemporaryUploadViewSet, basename='tempupload')
router.register(r'activity-discussions', ActivityDiscussionViewSet, basename='activitydiscussion')
router.register(r'activity-announcements', ActivityAnnouncementViewSet, basename='activityannouncement')

urlpatterns = [
    path('', include(router.urls)),
    path('auth/login/', CustomTokenObtainPairView.as_view(), name='auth_login'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='auth_refresh'),
    path('token/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('verify-nfc/', VerifyNFCView.as_view(), name='verify_nfc'),
    path('dashboard/', DashboardStatisticsView.as_view(), name='dashboard_statistics'),
    path('student/submissions/upload', StudentSubmissionUpload.as_view(), name='student_submission_upload'),
]
