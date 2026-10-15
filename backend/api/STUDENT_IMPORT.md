# Admin Student Spreadsheet Import

The create-only importer is available to staff in Django Admin at:

```text
/admin/api/studentprofile/import-students/
```

It accepts `.xlsx` files only; `.xls` is not supported. The Students changelist also has an **Import Students (.xlsx)** button and links to a downloadable template at `backend/api/static/api/student_import_template.xlsx`.

Use the exact header order shown here. Headers are case-insensitive and may use spaces or underscores, but columns cannot be reordered or omitted. The former eight-column template is rejected with an instruction to download the current template.

```text
Student ID | First Name | Last Name | Email | Role | Subject
```

## Columns

| Column | Required | Meaning |
| --- | --- | --- |
| Student ID | Yes | Unique student identifier; store as text in Excel to preserve leading zeroes. |
| First Name | Yes | User first name. |
| Last Name | Yes | User last name. |
| Email | Yes | Unique, valid email address. |
| Role | Yes | Must be `student`; this importer creates pre-enrollment student accounts only. |
| Subject | No | A `Section.subject_code` identifier, not a subject name. Blank means no section; a value must match exactly one existing section's subject code. |

The downloadable sample leaves Subject blank so it is portable. If supplied, the value must match an existing `Section.subject_code` exactly (case-insensitively). The importer generates the login username from Student ID (`student_` plus a sanitized ID), sets no NFC UID, and sets an unusable password. Do not include `nfc_uid`, username, password, token, or credential columns. NFC UID and password assignment remain in the existing enrollment workflow.

The import is create-only: a student ID, username, or email already present in the database is an error; existing records are never overwritten. The entire workbook is validated before confirmation, previewed with row-numbered errors, revalidated at confirmation, and saved in one transaction. Any validation or uniqueness conflict prevents all writes. The result reports created and updated counts; updated is always zero in this version.