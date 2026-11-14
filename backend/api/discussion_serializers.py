from rest_framework import serializers

from .models import ActivityDiscussion, ActivityDiscussionAttachment


class ActivityDiscussionAttachmentSerializer(serializers.ModelSerializer):
    filename = serializers.CharField(source='original_filename', read_only=True)
    url = serializers.SerializerMethodField()

    class Meta:
        model = ActivityDiscussionAttachment
        fields = ['id', 'filename', 'file_size', 'content_type', 'uploaded_at', 'url']
        read_only_fields = fields

    def get_url(self, obj):
        return None


class ActivityDiscussionSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source='sender.first_name', read_only=True)
    sender_last_name = serializers.CharField(source='sender.last_name', read_only=True)
    sender_profile_image = serializers.SerializerMethodField()
    message = serializers.CharField(required=False, allow_blank=True)
    attachment = serializers.FileField(write_only=True, required=False, allow_null=True)
    attachments = ActivityDiscussionAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = ActivityDiscussion
        fields = [
            'id', 'activity', 'sender', 'sender_name', 'sender_last_name',
            'sender_profile_image', 'sender_role', 'message', 'attachments',
            'attachment', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'sender', 'sender_name', 'sender_last_name',
            'sender_profile_image', 'created_at', 'updated_at',
        ]

    def _save_attachment(self, discussion, uploaded_file):
        original_filename = (uploaded_file.name or '').replace('\\', '/').rsplit('/', 1)[-1]
        ActivityDiscussionAttachment.objects.create(
            discussion=discussion,
            file=uploaded_file,
            original_filename=original_filename,
            file_size=getattr(uploaded_file, 'size', 0) or 0,
            content_type=getattr(uploaded_file, 'content_type', '') or '',
        )

    def create(self, validated_data):
        attachment = validated_data.pop('attachment', None)
        discussion = super().create(validated_data)
        if attachment:
            self._save_attachment(discussion, attachment)
        return discussion

    def update(self, instance, validated_data):
        attachment = validated_data.pop('attachment', None)
        discussion = super().update(instance, validated_data)
        if attachment:
            self._save_attachment(discussion, attachment)
        return discussion

    def get_sender_profile_image(self, obj):
        if not obj.sender or not obj.sender.profile_image:
            return None
        request = self.context.get('request')
        try:
            url = obj.sender.profile_image.url
        except Exception:
            return None
        return request.build_absolute_uri(url) if request else url
