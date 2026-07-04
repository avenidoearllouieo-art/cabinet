import { createHotContext as __vite__createHotContext } from "/@vite/client";import.meta.hot = __vite__createHotContext("/src/pages/admin/Users.jsx");const useEffect = __vite__cjsImport0_react["useEffect"]; const useState = __vite__cjsImport0_react["useState"];const _jsxDEV = __vite__cjsImport8_react_jsxDevRuntime["jsxDEV"];import __vite__cjsImport0_react from "/node_modules/.vite/deps/react.js?v=26bf7464";
import { useNavigate } from "/node_modules/.vite/deps/react-router-dom.js?v=26bf7464";
import api from "/src/services/api.js";
import PageHeader from "/src/components/PageHeader.jsx";
import StatCard from "/src/components/StatCard.jsx";
import DataTable from "/src/components/DataTable.jsx";
import AddUserModal from "/src/components/users/AddUserModal.jsx";
import { Search, Plus, Users as UsersIcon, CheckCircle2, CircleOff } from "/node_modules/.vite/deps/lucide-react.js?v=26bf7464";
var _jsxFileName = "C:/Users/Avenido/CapstoneCabinet/frontend/src/pages/admin/Users.jsx";
import __vite__cjsImport8_react_jsxDevRuntime from "/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=26bf7464";
var _s = $RefreshSig$();
export default function Users() {
	_s();
	const navigate = useNavigate();
	const [users, setUsers] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [query, setQuery] = useState("");
	const [isAddUserOpen, setIsAddUserOpen] = useState(false);
	const [toastMessage, setToastMessage] = useState("");
	const handleOpenAddUserModal = () => {
		console.log("modal marker active");
		setIsAddUserOpen(true);
	};
	useEffect(() => {
		fetchUsers();
	}, []);
	const fetchUsers = async () => {
		try {
			setLoading(true);
			const response = await api.get("/users/");
			setUsers(Array.isArray(response.data) ? response.data : response.data.results || []);
			setError("");
		} catch (err) {
			console.error("Error fetching users:", err);
			setError("Failed to load users.");
		} finally {
			setLoading(false);
		}
	};
	const filteredUsers = users.filter((user) => {
		const keyword = query.toLowerCase();
		return [
			user.username,
			user.email,
			user.first_name,
			user.last_name,
			user.student_id
		].filter(Boolean).some((value) => String(value).toLowerCase().includes(keyword));
	});
	const columns = [
		{
			key: "student_id",
			label: "Student ID"
		},
		{
			key: "username",
			label: "Username"
		},
		{
			key: "name",
			label: "Name",
			render: (_value, row) => {
				const fullName = `${row.first_name || ""} ${row.last_name || ""}`.trim();
				return fullName || "—";
			}
		},
		{
			key: "email",
			label: "Email"
		},
		{
			key: "role",
			label: "Role"
		},
		{
			key: "status",
			label: "Status",
			render: (_value, row) => /* @__PURE__ */ _jsxDEV("span", {
				className: `inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${row.is_active ? "bg-[#ECFDF3] text-[#16A34A]" : "bg-[#FEF2F2] text-[#DC2626]"}`,
				children: [row.is_active ? /* @__PURE__ */ _jsxDEV(CheckCircle2, { size: 12 }, void 0, false, {
					fileName: _jsxFileName,
					lineNumber: 67,
					columnNumber: 28
				}, this) : /* @__PURE__ */ _jsxDEV(CircleOff, { size: 12 }, void 0, false, {
					fileName: _jsxFileName,
					lineNumber: 67,
					columnNumber: 57
				}, this), row.is_active ? "Active" : "Inactive"]
			}, void 0, true, {
				fileName: _jsxFileName,
				lineNumber: 66,
				columnNumber: 9
			}, this)
		}
	];
	const totalUsers = users.length;
	const activeUsers = users.filter((user) => user.is_active).length;
	const inactiveUsers = totalUsers - activeUsers;
	return /* @__PURE__ */ _jsxDEV("div", {
		className: "space-y-8",
		children: [
			/* @__PURE__ */ _jsxDEV(PageHeader, {
				title: "Users Management",
				description: "Manage system users, roles, and permissions",
				action: /* @__PURE__ */ _jsxDEV("button", {
					type: "button",
					onClick: handleOpenAddUserModal,
					className: "flex items-center gap-2 rounded-[10px] bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1D4ED8]",
					children: [/* @__PURE__ */ _jsxDEV(Plus, { size: 16 }, void 0, false, {
						fileName: _jsxFileName,
						lineNumber: 89,
						columnNumber: 13
					}, this), "Add User"]
				}, void 0, true, {
					fileName: _jsxFileName,
					lineNumber: 84,
					columnNumber: 11
				}, this)
			}, void 0, false, {
				fileName: _jsxFileName,
				lineNumber: 80,
				columnNumber: 7
			}, this),
			/* @__PURE__ */ _jsxDEV("div", {
				className: "grid gap-6 md:grid-cols-3",
				children: [
					/* @__PURE__ */ _jsxDEV(StatCard, {
						icon: /* @__PURE__ */ _jsxDEV(UsersIcon, { size: 18 }, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 96,
							columnNumber: 25
						}, this),
						label: "Total Users",
						value: totalUsers,
						subtitle: "All registered accounts"
					}, void 0, false, {
						fileName: _jsxFileName,
						lineNumber: 96,
						columnNumber: 9
					}, this),
					/* @__PURE__ */ _jsxDEV(StatCard, {
						icon: /* @__PURE__ */ _jsxDEV(CheckCircle2, { size: 18 }, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 97,
							columnNumber: 25
						}, this),
						label: "Active",
						value: activeUsers,
						subtitle: "Currently active"
					}, void 0, false, {
						fileName: _jsxFileName,
						lineNumber: 97,
						columnNumber: 9
					}, this),
					/* @__PURE__ */ _jsxDEV(StatCard, {
						icon: /* @__PURE__ */ _jsxDEV(CircleOff, { size: 18 }, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 98,
							columnNumber: 25
						}, this),
						label: "Inactive",
						value: inactiveUsers,
						subtitle: "Pending review"
					}, void 0, false, {
						fileName: _jsxFileName,
						lineNumber: 98,
						columnNumber: 9
					}, this)
				]
			}, void 0, true, {
				fileName: _jsxFileName,
				lineNumber: 95,
				columnNumber: 7
			}, this),
			error && /* @__PURE__ */ _jsxDEV("div", {
				className: "rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]",
				children: error
			}, void 0, false, {
				fileName: _jsxFileName,
				lineNumber: 102,
				columnNumber: 9
			}, this),
			/* @__PURE__ */ _jsxDEV("div", {
				className: "rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm",
				children: [/* @__PURE__ */ _jsxDEV("div", {
					className: "mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between",
					children: [/* @__PURE__ */ _jsxDEV("div", { children: [/* @__PURE__ */ _jsxDEV("h2", {
						className: "text-lg font-semibold text-[#111827]",
						children: "User Directory"
					}, void 0, false, {
						fileName: _jsxFileName,
						lineNumber: 110,
						columnNumber: 13
					}, this), /* @__PURE__ */ _jsxDEV("p", {
						className: "text-sm text-[#6B7280]",
						children: "Browse registered users and their roles."
					}, void 0, false, {
						fileName: _jsxFileName,
						lineNumber: 111,
						columnNumber: 13
					}, this)] }, void 0, true, {
						fileName: _jsxFileName,
						lineNumber: 109,
						columnNumber: 11
					}, this), /* @__PURE__ */ _jsxDEV("label", {
						className: "relative block w-full md:w-[320px]",
						children: [/* @__PURE__ */ _jsxDEV("span", {
							className: "pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#6B7280]",
							children: /* @__PURE__ */ _jsxDEV(Search, { size: 16 }, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 115,
								columnNumber: 15
							}, this)
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 114,
							columnNumber: 13
						}, this), /* @__PURE__ */ _jsxDEV("input", {
							value: query,
							onChange: (e) => setQuery(e.target.value),
							placeholder: "Search users...",
							className: "h-10 w-full rounded-[10px] border border-[#D1D5DB] bg-white pl-9 pr-3 text-sm text-[#374151] outline-none focus:border-[#2563EB]"
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 117,
							columnNumber: 13
						}, this)]
					}, void 0, true, {
						fileName: _jsxFileName,
						lineNumber: 113,
						columnNumber: 11
					}, this)]
				}, void 0, true, {
					fileName: _jsxFileName,
					lineNumber: 108,
					columnNumber: 9
				}, this), /* @__PURE__ */ _jsxDEV(DataTable, {
					columns,
					data: filteredUsers,
					loading
				}, void 0, false, {
					fileName: _jsxFileName,
					lineNumber: 125,
					columnNumber: 9
				}, this)]
			}, void 0, true, {
				fileName: _jsxFileName,
				lineNumber: 107,
				columnNumber: 7
			}, this),
			toastMessage && /* @__PURE__ */ _jsxDEV("div", {
				className: "fixed bottom-6 right-6 z-50 rounded-[14px] border border-[#D1FAE5] bg-[#ECFDF5] px-5 py-4 text-sm text-[#065F46] shadow-lg",
				children: toastMessage
			}, void 0, false, {
				fileName: _jsxFileName,
				lineNumber: 129,
				columnNumber: 9
			}, this),
			/* @__PURE__ */ _jsxDEV(AddUserModal, {
				isOpen: isAddUserOpen,
				onClose: () => setIsAddUserOpen(false),
				onUnauthorized: () => navigate("/admin/login"),
				onSaved: () => {
					setToastMessage("User created successfully.");
					setIsAddUserOpen(false);
					fetchUsers();
					window.setTimeout(() => setToastMessage(""), 4e3);
				}
			}, void 0, false, {
				fileName: _jsxFileName,
				lineNumber: 134,
				columnNumber: 7
			}, this)
		]
	}, void 0, true, {
		fileName: _jsxFileName,
		lineNumber: 79,
		columnNumber: 5
	}, this);
}
_s(Users, "na7j+qH8x+La6yBm+V03Kd0PoTI=", false, function() {
	return [useNavigate];
});
_c = Users;
var _c;
$RefreshReg$(_c, "Users");
import * as RefreshRuntime from "/@react-refresh";
const inWebWorker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
import * as __vite_react_currentExports from "/src/pages/admin/Users.jsx";
if (import.meta.hot && !inWebWorker) {
  if (!window.$RefreshReg$) {
    throw new Error(
      "@vitejs/plugin-react can't detect preamble. Something is wrong."
    );
  }

  const currentExports = __vite_react_currentExports;
  queueMicrotask(() => {
    RefreshRuntime.registerExportsForReactRefresh("C:/Users/Avenido/CapstoneCabinet/frontend/src/pages/admin/Users.jsx", currentExports);
    import.meta.hot.accept((nextExports) => {
      if (!nextExports) return;
      const invalidateMessage = RefreshRuntime.validateRefreshBoundaryAndEnqueueUpdate("C:/Users/Avenido/CapstoneCabinet/frontend/src/pages/admin/Users.jsx", currentExports, nextExports);
      if (invalidateMessage) import.meta.hot.invalidate(invalidateMessage);
    });
  });
}
function $RefreshReg$(type, id) { return RefreshRuntime.register(type, "C:/Users/Avenido/CapstoneCabinet/frontend/src/pages/admin/Users.jsx" + ' ' + id); }
function $RefreshSig$() { return RefreshRuntime.createSignatureFunctionForTransform(); }

//# sourceMappingURL=data:application/json;base64,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S0FBSztJQUNyQyxzQkFBc0IsU0FBUyxjQUFjO0lBQzdDLGVBQWU7S0FDYixnQkFBZ0IsNEJBQTRCO0tBQzVDLGlCQUFpQixLQUFLO0tBQ3RCLFdBQVc7S0FDWCxPQUFPLGlCQUFpQixnQkFBZ0IsRUFBRSxHQUFHLEdBQUk7SUFDbkQ7R0FDRDs7Ozs7RUFDRTs7Ozs7O0FBRVQiLCJuYW1lcyI6W10sInNvdXJjZXMiOlsiVXNlcnMuanN4Il0sInZlcnNpb24iOjMsInNvdXJjZXNDb250ZW50IjpbIu+7v2ltcG9ydCB7IHVzZUVmZmVjdCwgdXNlU3RhdGUgfSBmcm9tICdyZWFjdCdcbmltcG9ydCB7IHVzZU5hdmlnYXRlIH0gZnJvbSAncmVhY3Qtcm91dGVyLWRvbSdcbmltcG9ydCBhcGkgZnJvbSAnLi4vLi4vc2VydmljZXMvYXBpLmpzJ1xuaW1wb3J0IFBhZ2VIZWFkZXIgZnJvbSAnLi4vLi4vY29tcG9uZW50cy9QYWdlSGVhZGVyJ1xuaW1wb3J0IFN0YXRDYXJkIGZyb20gJy4uLy4uL2NvbXBvbmVudHMvU3RhdENhcmQnXG5pbXBvcnQgRGF0YVRhYmxlIGZyb20gJy4uLy4uL2NvbXBvbmVudHMvRGF0YVRhYmxlJ1xuaW1wb3J0IEFkZFVzZXJNb2RhbCBmcm9tICcuLi8uLi9jb21wb25lbnRzL3VzZXJzL0FkZFVzZXJNb2RhbC5qc3gnXG5pbXBvcnQgeyBTZWFyY2gsIFBsdXMsIFVzZXJzIGFzIFVzZXJzSWNvbiwgQ2hlY2tDaXJjbGUyLCBDaXJjbGVPZmYgfSBmcm9tICdsdWNpZGUtcmVhY3QnXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIFVzZXJzKCkge1xuICBjb25zdCBuYXZpZ2F0ZSA9IHVzZU5hdmlnYXRlKClcbiAgY29uc3QgW3VzZXJzLCBzZXRVc2Vyc10gPSB1c2VTdGF0ZShbXSlcbiAgY29uc3QgW2xvYWRpbmcsIHNldExvYWRpbmddID0gdXNlU3RhdGUodHJ1ZSlcbiAgY29uc3QgW2Vycm9yLCBzZXRFcnJvcl0gPSB1c2VTdGF0ZSgnJylcbiAgY29uc3QgW3F1ZXJ5LCBzZXRRdWVyeV0gPSB1c2VTdGF0ZSgnJylcbiAgY29uc3QgW2lzQWRkVXNlck9wZW4sIHNldElzQWRkVXNlck9wZW5dID0gdXNlU3RhdGUoZmFsc2UpXG4gIGNvbnN0IFt0b2FzdE1lc3NhZ2UsIHNldFRvYXN0TWVzc2FnZV0gPSB1c2VTdGF0ZSgnJylcblxuICBjb25zdCBoYW5kbGVPcGVuQWRkVXNlck1vZGFsID0gKCkgPT4ge1xuICAgIGNvbnNvbGUubG9nKCdtb2RhbCBtYXJrZXIgYWN0aXZlJylcbiAgICBzZXRJc0FkZFVzZXJPcGVuKHRydWUpXG4gIH1cblxuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGZldGNoVXNlcnMoKVxuICB9LCBbXSlcblxuICBjb25zdCBmZXRjaFVzZXJzID0gYXN5bmMgKCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBzZXRMb2FkaW5nKHRydWUpXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGFwaS5nZXQoJy91c2Vycy8nKVxuICAgICAgc2V0VXNlcnMoQXJyYXkuaXNBcnJheShyZXNwb25zZS5kYXRhKSA/IHJlc3BvbnNlLmRhdGEgOiByZXNwb25zZS5kYXRhLnJlc3VsdHMgfHwgW10pXG4gICAgICBzZXRFcnJvcignJylcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGZldGNoaW5nIHVzZXJzOicsIGVycilcbiAgICAgIHNldEVycm9yKCdGYWlsZWQgdG8gbG9hZCB1c2Vycy4nKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBzZXRMb2FkaW5nKGZhbHNlKVxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGZpbHRlcmVkVXNlcnMgPSB1c2Vycy5maWx0ZXIoKHVzZXIpID0+IHtcbiAgICBjb25zdCBrZXl3b3JkID0gcXVlcnkudG9Mb3dlckNhc2UoKVxuICAgIHJldHVybiBbdXNlci51c2VybmFtZSwgdXNlci5lbWFpbCwgdXNlci5maXJzdF9uYW1lLCB1c2VyLmxhc3RfbmFtZSwgdXNlci5zdHVkZW50X2lkXVxuICAgICAgLmZpbHRlcihCb29sZWFuKVxuICAgICAgLnNvbWUoKHZhbHVlKSA9PiBTdHJpbmcodmFsdWUpLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoa2V5d29yZCkpXG4gIH0pXG5cbiAgY29uc3QgY29sdW1ucyA9IFtcbiAgICB7IGtleTogJ3N0dWRlbnRfaWQnLCBsYWJlbDogJ1N0dWRlbnQgSUQnIH0sXG4gICAgeyBrZXk6ICd1c2VybmFtZScsIGxhYmVsOiAnVXNlcm5hbWUnIH0sXG4gICAge1xuICAgICAga2V5OiAnbmFtZScsXG4gICAgICBsYWJlbDogJ05hbWUnLFxuICAgICAgcmVuZGVyOiAoX3ZhbHVlLCByb3cpID0+IHtcbiAgICAgICAgY29uc3QgZnVsbE5hbWUgPSBgJHtyb3cuZmlyc3RfbmFtZSB8fCAnJ30gJHtyb3cubGFzdF9uYW1lIHx8ICcnfWAudHJpbSgpXG4gICAgICAgIHJldHVybiBmdWxsTmFtZSB8fCAn4oCUJ1xuICAgICAgfSxcbiAgICB9LFxuICAgIHsga2V5OiAnZW1haWwnLCBsYWJlbDogJ0VtYWlsJyB9LFxuICAgIHsga2V5OiAncm9sZScsIGxhYmVsOiAnUm9sZScgfSxcbiAgICB7XG4gICAgICBrZXk6ICdzdGF0dXMnLFxuICAgICAgbGFiZWw6ICdTdGF0dXMnLFxuICAgICAgcmVuZGVyOiAoX3ZhbHVlLCByb3cpID0+IChcbiAgICAgICAgPHNwYW4gY2xhc3NOYW1lPXtgaW5saW5lLWZsZXggaXRlbXMtY2VudGVyIGdhcC0xIHJvdW5kZWQtZnVsbCBweC0zIHB5LTEgdGV4dC14cyBmb250LXNlbWlib2xkICR7cm93LmlzX2FjdGl2ZSA/ICdiZy1bI0VDRkRGM10gdGV4dC1bIzE2QTM0QV0nIDogJ2JnLVsjRkVGMkYyXSB0ZXh0LVsjREMyNjI2XSd9YH0+XG4gICAgICAgICAge3Jvdy5pc19hY3RpdmUgPyA8Q2hlY2tDaXJjbGUyIHNpemU9ezEyfSAvPiA6IDxDaXJjbGVPZmYgc2l6ZT17MTJ9IC8+fVxuICAgICAgICAgIHtyb3cuaXNfYWN0aXZlID8gJ0FjdGl2ZScgOiAnSW5hY3RpdmUnfVxuICAgICAgICA8L3NwYW4+XG4gICAgICApLFxuICAgIH0sXG4gIF1cblxuICBjb25zdCB0b3RhbFVzZXJzID0gdXNlcnMubGVuZ3RoXG4gIGNvbnN0IGFjdGl2ZVVzZXJzID0gdXNlcnMuZmlsdGVyKCh1c2VyKSA9PiB1c2VyLmlzX2FjdGl2ZSkubGVuZ3RoXG4gIGNvbnN0IGluYWN0aXZlVXNlcnMgPSB0b3RhbFVzZXJzIC0gYWN0aXZlVXNlcnNcblxuICByZXR1cm4gKFxuICAgIDxkaXYgY2xhc3NOYW1lPVwic3BhY2UteS04XCI+XG4gICAgICA8UGFnZUhlYWRlclxuICAgICAgICB0aXRsZT1cIlVzZXJzIE1hbmFnZW1lbnRcIlxuICAgICAgICBkZXNjcmlwdGlvbj1cIk1hbmFnZSBzeXN0ZW0gdXNlcnMsIHJvbGVzLCBhbmQgcGVybWlzc2lvbnNcIlxuICAgICAgICBhY3Rpb249e1xuICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgIHR5cGU9XCJidXR0b25cIlxuICAgICAgICAgICAgb25DbGljaz17aGFuZGxlT3BlbkFkZFVzZXJNb2RhbH1cbiAgICAgICAgICAgIGNsYXNzTmFtZT1cImZsZXggaXRlbXMtY2VudGVyIGdhcC0yIHJvdW5kZWQtWzEwcHhdIGJnLVsjMjU2M0VCXSBweC00IHB5LTIgdGV4dC1zbSBmb250LXNlbWlib2xkIHRleHQtd2hpdGUgc2hhZG93LXNtIHRyYW5zaXRpb24gaG92ZXI6YmctWyMxRDRFRDhdXCJcbiAgICAgICAgICA+XG4gICAgICAgICAgICA8UGx1cyBzaXplPXsxNn0gLz5cbiAgICAgICAgICAgIEFkZCBVc2VyXG4gICAgICAgICAgPC9idXR0b24+XG4gICAgICAgIH1cbiAgICAgIC8+XG5cbiAgICAgIDxkaXYgY2xhc3NOYW1lPVwiZ3JpZCBnYXAtNiBtZDpncmlkLWNvbHMtM1wiPlxuICAgICAgICA8U3RhdENhcmQgaWNvbj17PFVzZXJzSWNvbiBzaXplPXsxOH0gLz59IGxhYmVsPVwiVG90YWwgVXNlcnNcIiB2YWx1ZT17dG90YWxVc2Vyc30gc3VidGl0bGU9XCJBbGwgcmVnaXN0ZXJlZCBhY2NvdW50c1wiIC8+XG4gICAgICAgIDxTdGF0Q2FyZCBpY29uPXs8Q2hlY2tDaXJjbGUyIHNpemU9ezE4fSAvPn0gbGFiZWw9XCJBY3RpdmVcIiB2YWx1ZT17YWN0aXZlVXNlcnN9IHN1YnRpdGxlPVwiQ3VycmVudGx5IGFjdGl2ZVwiIC8+XG4gICAgICAgIDxTdGF0Q2FyZCBpY29uPXs8Q2lyY2xlT2ZmIHNpemU9ezE4fSAvPn0gbGFiZWw9XCJJbmFjdGl2ZVwiIHZhbHVlPXtpbmFjdGl2ZVVzZXJzfSBzdWJ0aXRsZT1cIlBlbmRpbmcgcmV2aWV3XCIgLz5cbiAgICAgIDwvZGl2PlxuXG4gICAgICB7ZXJyb3IgJiYgKFxuICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cInJvdW5kZWQtWzEycHhdIGJvcmRlciBib3JkZXItWyNGRUNBQ0FdIGJnLVsjRkVGMkYyXSBweC00IHB5LTMgdGV4dC1zbSB0ZXh0LVsjREMyNjI2XVwiPlxuICAgICAgICAgIHtlcnJvcn1cbiAgICAgICAgPC9kaXY+XG4gICAgICApfVxuXG4gICAgICA8ZGl2IGNsYXNzTmFtZT1cInJvdW5kZWQtWzEycHhdIGJvcmRlciBib3JkZXItWyNFNUU3RUJdIGJnLXdoaXRlIHAtNiBzaGFkb3ctc21cIj5cbiAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJtYi00IGZsZXggZmxleC1jb2wgZ2FwLTQgbWQ6ZmxleC1yb3cgbWQ6aXRlbXMtY2VudGVyIG1kOmp1c3RpZnktYmV0d2VlblwiPlxuICAgICAgICAgIDxkaXY+XG4gICAgICAgICAgICA8aDIgY2xhc3NOYW1lPVwidGV4dC1sZyBmb250LXNlbWlib2xkIHRleHQtWyMxMTE4MjddXCI+VXNlciBEaXJlY3Rvcnk8L2gyPlxuICAgICAgICAgICAgPHAgY2xhc3NOYW1lPVwidGV4dC1zbSB0ZXh0LVsjNkI3MjgwXVwiPkJyb3dzZSByZWdpc3RlcmVkIHVzZXJzIGFuZCB0aGVpciByb2xlcy48L3A+XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgPGxhYmVsIGNsYXNzTmFtZT1cInJlbGF0aXZlIGJsb2NrIHctZnVsbCBtZDp3LVszMjBweF1cIj5cbiAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT1cInBvaW50ZXItZXZlbnRzLW5vbmUgYWJzb2x1dGUgaW5zZXQteS0wIGxlZnQtMyBmbGV4IGl0ZW1zLWNlbnRlciB0ZXh0LVsjNkI3MjgwXVwiPlxuICAgICAgICAgICAgICA8U2VhcmNoIHNpemU9ezE2fSAvPlxuICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgPGlucHV0XG4gICAgICAgICAgICAgIHZhbHVlPXtxdWVyeX1cbiAgICAgICAgICAgICAgb25DaGFuZ2U9eyhlKSA9PiBzZXRRdWVyeShlLnRhcmdldC52YWx1ZSl9XG4gICAgICAgICAgICAgIHBsYWNlaG9sZGVyPVwiU2VhcmNoIHVzZXJzLi4uXCJcbiAgICAgICAgICAgICAgY2xhc3NOYW1lPVwiaC0xMCB3LWZ1bGwgcm91bmRlZC1bMTBweF0gYm9yZGVyIGJvcmRlci1bI0QxRDVEQl0gYmctd2hpdGUgcGwtOSBwci0zIHRleHQtc20gdGV4dC1bIzM3NDE1MV0gb3V0bGluZS1ub25lIGZvY3VzOmJvcmRlci1bIzI1NjNFQl1cIlxuICAgICAgICAgICAgLz5cbiAgICAgICAgICA8L2xhYmVsPlxuICAgICAgICA8L2Rpdj5cbiAgICAgICAgPERhdGFUYWJsZSBjb2x1bW5zPXtjb2x1bW5zfSBkYXRhPXtmaWx0ZXJlZFVzZXJzfSBsb2FkaW5nPXtsb2FkaW5nfSAvPlxuICAgICAgPC9kaXY+XG5cbiAgICAgIHt0b2FzdE1lc3NhZ2UgJiYgKFxuICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImZpeGVkIGJvdHRvbS02IHJpZ2h0LTYgei01MCByb3VuZGVkLVsxNHB4XSBib3JkZXIgYm9yZGVyLVsjRDFGQUU1XSBiZy1bI0VDRkRGNV0gcHgtNSBweS00IHRleHQtc20gdGV4dC1bIzA2NUY0Nl0gc2hhZG93LWxnXCI+XG4gICAgICAgICAge3RvYXN0TWVzc2FnZX1cbiAgICAgICAgPC9kaXY+XG4gICAgICApfVxuXG4gICAgICA8QWRkVXNlck1vZGFsXG4gICAgICAgIGlzT3Blbj17aXNBZGRVc2VyT3Blbn1cbiAgICAgICAgb25DbG9zZT17KCkgPT4gc2V0SXNBZGRVc2VyT3BlbihmYWxzZSl9XG4gICAgICAgIG9uVW5hdXRob3JpemVkPXsoKSA9PiBuYXZpZ2F0ZSgnL2FkbWluL2xvZ2luJyl9XG4gICAgICAgIG9uU2F2ZWQ9eygpID0+IHtcbiAgICAgICAgICBzZXRUb2FzdE1lc3NhZ2UoJ1VzZXIgY3JlYXRlZCBzdWNjZXNzZnVsbHkuJylcbiAgICAgICAgICBzZXRJc0FkZFVzZXJPcGVuKGZhbHNlKVxuICAgICAgICAgIGZldGNoVXNlcnMoKVxuICAgICAgICAgIHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHNldFRvYXN0TWVzc2FnZSgnJyksIDQwMDApXG4gICAgICAgIH19XG4gICAgICAvPlxuICAgIDwvZGl2PlxuICApXG59XHJcbiJdfQ==