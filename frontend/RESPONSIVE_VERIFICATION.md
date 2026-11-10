# Responsive Verification Checklist

## Method

- Routes were taken from `src/App.jsx`, including authentication pages, role index redirects, the Admin Settings placeholder, and parameterized Instructor pages.
- Browser viewport checks ran against the frontend at `http://127.0.0.1:5177` at 320, 360, 375, 390, 430, 600, 768, 1024, and 1440px.
- Each route rendered under a synthetic role session. API requests were blocked to avoid backend writes; checks cover layout and control bounds, not live-data behavior.
- The browser check asserted no document/main horizontal overflow and no clipped page controls. Dialog geometry and navigation open/close behavior were checked separately at 320/599/600px.
- Visual screenshots were inspected for Student Activities at 320px, Student Dashboard at 375px with a sample activity, and the Student notification panel at 320px. Other routes were not claimed as visually inspected.

## Route Checklist

`Source review` means the route/component and its shared responsive pattern were inspected. `Automated` is the nine-width browser check above. `Visual` is limited to screenshots actually inspected.

| Role | Route | Source review | Automated | Visual |
|---|---|---|---|---|
| Public | `/` Login | Yes | Pass | No |
| Public | `/forgot-password` | Yes | Pass | No |
| Public | `/register` | Yes | Pass | No |
| Admin | `/admin/login` | Yes | Pass | No |
| Instructor | `/instructor/login` | Yes | Pass | No |
| Student | `/student/login` | Yes | Pass | No |
| Admin | `/admin` (redirect) | Yes | Pass | No |
| Admin | `/admin/dashboard` | Yes | Pass | No |
| Admin | `/admin/users` | Yes | Pass | No |
| Admin | `/admin/activities` | Yes | Pass | No |
| Admin | `/admin/submissions` | Yes | Pass | No |
| Admin | `/admin/access-logs` | Yes | Pass | No |
| Admin | `/admin/cabinet-events` | Yes | Pass | No |
| Admin | `/admin/sections` | Yes | Pass | No |
| Admin | `/admin/settings` (placeholder) | Yes | Pass | No |
| Instructor | `/instructor` (redirect) | Yes | Pass | No |
| Instructor | `/instructor/dashboard` | Yes | Pass | No |
| Instructor | `/instructor/sections` | Yes | Pass | No |
| Instructor | `/instructor/sections/:sectionId/students` | Yes | Pass | No |
| Instructor | `/instructor/students/:studentId` | Yes | Pass | No |
| Instructor | `/instructor/profile` | Yes | Pass | No |
| Instructor | `/instructor/profile/change-password` | Yes | Pass | No |
| Instructor | `/instructor/activities` | Yes | Pass | No |
| Instructor | `/instructor/activities/:activityId` | Yes | Pass | No |
| Instructor | `/instructor/submissions` | Yes | Pass | No |
| Instructor | `/instructor/access-logs` | Yes | Pass | No |
| Instructor | `/instructor/notifications` | Yes | Pass | No |
| Student | `/student` (redirect) | Yes | Pass | No |
| Student | `/student/dashboard` | Yes | Pass | Yes (375px) |
| Student | `/student/activities` | Yes | Pass | Yes (320px) |
| Student | `/student/submissions` | Yes | Pass | No |
| Student | `/student/access-logs` | Yes | Pass | No |
| Student | `/student/profile` | Yes | Pass | No |
| Student | `/student/profile/change-password` | Yes | Pass | No |

## Shared Interaction Checks

- Mobile sidebar opens as an overlay below 600px, closes after navigation, and uses the same navy background as the header.
- Tablet sidebar is visible and collapses/expands at 600px; one responsive logo variant is visible at a time.
- Admin Users Add Student dialog fits at 320px; fields, internal scrolling, and footer actions remain within its bounds.
- Account menu and Student notification panel remain within the 320px viewport.
- Student Dashboard uses activity cards below 600px and preserves the full table at tablet/desktop widths.

## Build Checks

- `npm run lint`: Pass
- `npm test`: Pass (39 Vitest tests and 5 Node tests)
- `npm run build`: Pass
