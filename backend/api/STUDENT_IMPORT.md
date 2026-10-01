# Admin Student Spreadsheet Import

The create-only importer is available to staff in Django Admin at:

```text
/admin/api/studentprofile/import-students/
```

It accepts `.xlsx` files. The Students changelist also has an **Import Students (.xlsx)** button and links to a downloadable fake-data template at `backend/api/static/api/student_import_template.xlsx`.

## Columns

| Column | Required | Meaning |
| --- | --- | --- |
| `student_id` | Yes | Unique student identifier; store as text in Excel to preserve leading zeroes. |
| `first_name` | Yes | User first name. |
| `last_name` | Yes | User last name. |
| `email` | Yes | Unique email address. |
| `section_code` | No | Blank means no section. A non-blank code must match exactly one `Section.section_code`. |
| `username` | No | If blank, generated as `student_` plus the student ID with characters outside Django's username set replaced by `_`, then leading/trailing underscores trimmed. For example, `DEMO-001` becomes `student_DEMO-001`. |
| `is_active` | No | Defaults to `true`; accepted values are true/false, yes/no, 1/0, active/inactive. |

The importer always creates role `student`, sets no NFC UID, and sets an unusable password. Do not include `role`, `nfc_uid`, password, token, or credential columns. NFC UID assignment and password creation remain in the existing enrollment workflow.

The import is create-only: a student ID, username, or email already present in the database is an error; existing records are never overwritten. The entire workbook is validated before confirmation, previewed with row-numbered errors, revalidated at confirmation, and saved in one transaction. Any validation or uniqueness conflict prevents all writes. The result reports created and updated counts; updated is always zero in this version.