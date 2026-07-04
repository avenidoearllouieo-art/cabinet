import { createHotContext as __vite__createHotContext } from "/@vite/client";import.meta.hot = __vite__createHotContext("/src/pages/admin/Users.jsx");const useEffect = __vite__cjsImport0_react["useEffect"]; const useState = __vite__cjsImport0_react["useState"];const _jsxDEV = __vite__cjsImport9_react_jsxDevRuntime["jsxDEV"];import __vite__cjsImport0_react from "/node_modules/.vite/deps/react.js?v=26bf7464";
import { useNavigate } from "/node_modules/.vite/deps/react-router-dom.js?v=26bf7464";
import api from "/src/services/api.js";
import PageHeader from "/src/components/PageHeader.jsx";
import StatCard from "/src/components/StatCard.jsx";
import DataTable from "/src/components/DataTable.jsx";
import AddUserModal from "/src/components/users/AddUserModal.jsx";
import EditUserModal from "/src/components/users/EditUserModal.jsx";
import { Search, Plus, Users as UsersIcon, CheckCircle2, CircleOff } from "/node_modules/.vite/deps/lucide-react.js?v=26bf7464";
var _jsxFileName = "C:/Users/Avenido/CapstoneCabinet/frontend/src/pages/admin/Users.jsx";
import __vite__cjsImport9_react_jsxDevRuntime from "/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=26bf7464";
var _s = $RefreshSig$();
export default function Users() {
	_s();
	const navigate = useNavigate();
	const [users, setUsers] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [query, setQuery] = useState("");
	const [isAddUserOpen, setIsAddUserOpen] = useState(false);
	const [isEditModalOpen, setIsEditModalOpen] = useState(false);
	const [editingUserId, setEditingUserId] = useState(null);
	const [selectedUser, setSelectedUser] = useState(null);
	const [toastMessage, setToastMessage] = useState("");
	const handleOpenAddUserModal = () => {
		setEditingUserId(null);
		setSelectedUser(null);
		setIsAddUserOpen(true);
	};
	const handleUserSaved = (savedUser) => {
		if (!savedUser || !savedUser.id) {
			fetchUsers();
			return;
		}
		setUsers((existingUsers) => {
			if (editingUserId) {
				return existingUsers.map((user) => user.id === savedUser.id ? savedUser : user);
			}
			return [savedUser, ...existingUsers];
		});
		setToastMessage(editingUserId ? "User updated successfully." : "User created successfully.");
		setIsAddUserOpen(false);
		setIsEditModalOpen(false);
		setEditingUserId(null);
		setSelectedUser(null);
		window.setTimeout(() => setToastMessage(""), 4e3);
	};
	useEffect(() => {
		fetchUsers();
	}, []);
	useEffect(() => {
		window.openEditModal = (id, row) => {
			if (!id) return;
			setEditingUserId(id);
			setSelectedUser(row || null);
			setIsEditModalOpen(true);
		};
		return () => {
			try {
				delete window.openEditModal;
			} catch (err) {}
		};
	}, []);
	const fetchUsers = async () => {
		try {
			setLoading(true);
			const response = await api.get("/users/");
			const rawUsers = Array.isArray(response.data) ? response.data : response.data.results || [];
			const normalizedUsers = rawUsers.map((user) => ({
				...user,
				id: user?.id ?? user?.pk ?? user?.user_id ?? user?.uuid
			}));
			setUsers(normalizedUsers);
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
	const getUserId = (row) => row?.id ?? row?.pk ?? row?.user_id ?? row?.uuid;
	const columns = [
		{
			key: "actions",
			label: "Actions",
			className: "w-[140px] text-left",
			render: (_value, row) => {
				const id = getUserId(row);
				return /* @__PURE__ */ _jsxDEV("button", {
					type: "button",
					"data-user-id": id || "",
					onClick: (e) => {
						e.stopPropagation();
						if (id != null) {
							setEditingUserId(id);
							setSelectedUser(row);
							setIsEditModalOpen(true);
						}
					},
					className: "rounded-full bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700",
					children: "Edit User"
				}, void 0, false, {
					fileName: _jsxFileName,
					lineNumber: 104,
					columnNumber: 11
				}, this);
			}
		},
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
			className: "min-w-[240px]",
			render: (_value, row) => {
				const fullName = `${row.first_name || ""} ${row.last_name || ""}`.trim() || "—";
				return /* @__PURE__ */ _jsxDEV("span", {
					className: "text-sm text-[#111827]",
					children: fullName
				}, void 0, false, {
					fileName: _jsxFileName,
					lineNumber: 130,
					columnNumber: 16
				}, this);
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
			key: "section",
			label: "Section"
		},
		{
			key: "status",
			label: "Status",
			render: (_value, row) => /* @__PURE__ */ _jsxDEV("span", {
				className: `inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${row.is_active ? "bg-[#ECFDF3] text-[#16A34A]" : "bg-[#FEF2F2] text-[#DC2626]"}`,
				children: [row.is_active ? /* @__PURE__ */ _jsxDEV(CheckCircle2, { size: 12 }, void 0, false, {
					fileName: _jsxFileName,
					lineNumber: 141,
					columnNumber: 28
				}, this) : /* @__PURE__ */ _jsxDEV(CircleOff, { size: 12 }, void 0, false, {
					fileName: _jsxFileName,
					lineNumber: 141,
					columnNumber: 57
				}, this), row.is_active ? "Active" : "Inactive"]
			}, void 0, true, {
				fileName: _jsxFileName,
				lineNumber: 140,
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
						lineNumber: 163,
						columnNumber: 13
					}, this), "Add User"]
				}, void 0, true, {
					fileName: _jsxFileName,
					lineNumber: 158,
					columnNumber: 11
				}, this)
			}, void 0, false, {
				fileName: _jsxFileName,
				lineNumber: 154,
				columnNumber: 7
			}, this),
			/* @__PURE__ */ _jsxDEV("div", {
				className: "grid gap-6 md:grid-cols-3",
				children: [
					/* @__PURE__ */ _jsxDEV(StatCard, {
						icon: /* @__PURE__ */ _jsxDEV(UsersIcon, { size: 18 }, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 170,
							columnNumber: 25
						}, this),
						label: "Total Users",
						value: totalUsers,
						subtitle: "All registered accounts"
					}, void 0, false, {
						fileName: _jsxFileName,
						lineNumber: 170,
						columnNumber: 9
					}, this),
					/* @__PURE__ */ _jsxDEV(StatCard, {
						icon: /* @__PURE__ */ _jsxDEV(CheckCircle2, { size: 18 }, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 171,
							columnNumber: 25
						}, this),
						label: "Active",
						value: activeUsers,
						subtitle: "Currently active"
					}, void 0, false, {
						fileName: _jsxFileName,
						lineNumber: 171,
						columnNumber: 9
					}, this),
					/* @__PURE__ */ _jsxDEV(StatCard, {
						icon: /* @__PURE__ */ _jsxDEV(CircleOff, { size: 18 }, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 172,
							columnNumber: 25
						}, this),
						label: "Inactive",
						value: inactiveUsers,
						subtitle: "Pending review"
					}, void 0, false, {
						fileName: _jsxFileName,
						lineNumber: 172,
						columnNumber: 9
					}, this)
				]
			}, void 0, true, {
				fileName: _jsxFileName,
				lineNumber: 169,
				columnNumber: 7
			}, this),
			error && /* @__PURE__ */ _jsxDEV("div", {
				className: "rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]",
				children: error
			}, void 0, false, {
				fileName: _jsxFileName,
				lineNumber: 176,
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
						lineNumber: 184,
						columnNumber: 13
					}, this), /* @__PURE__ */ _jsxDEV("p", {
						className: "text-sm text-[#6B7280]",
						children: "Browse registered users and their roles."
					}, void 0, false, {
						fileName: _jsxFileName,
						lineNumber: 185,
						columnNumber: 13
					}, this)] }, void 0, true, {
						fileName: _jsxFileName,
						lineNumber: 183,
						columnNumber: 11
					}, this), /* @__PURE__ */ _jsxDEV("label", {
						className: "relative block w-full md:w-[320px]",
						children: [/* @__PURE__ */ _jsxDEV("span", {
							className: "pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#6B7280]",
							children: /* @__PURE__ */ _jsxDEV(Search, { size: 16 }, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 189,
								columnNumber: 15
							}, this)
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 188,
							columnNumber: 13
						}, this), /* @__PURE__ */ _jsxDEV("input", {
							value: query,
							onChange: (e) => setQuery(e.target.value),
							placeholder: "Search users...",
							className: "h-10 w-full rounded-[10px] border border-[#D1D5DB] bg-white pl-9 pr-3 text-sm text-[#374151] outline-none focus:border-[#2563EB]"
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 191,
							columnNumber: 13
						}, this)]
					}, void 0, true, {
						fileName: _jsxFileName,
						lineNumber: 187,
						columnNumber: 11
					}, this)]
				}, void 0, true, {
					fileName: _jsxFileName,
					lineNumber: 182,
					columnNumber: 9
				}, this), /* @__PURE__ */ _jsxDEV(DataTable, {
					columns,
					data: filteredUsers,
					loading
				}, void 0, false, {
					fileName: _jsxFileName,
					lineNumber: 199,
					columnNumber: 9
				}, this)]
			}, void 0, true, {
				fileName: _jsxFileName,
				lineNumber: 181,
				columnNumber: 7
			}, this),
			toastMessage && /* @__PURE__ */ _jsxDEV("div", {
				className: "fixed bottom-6 right-6 z-50 rounded-[14px] border border-[#D1FAE5] bg-[#ECFDF5] px-5 py-4 text-sm text-[#065F46] shadow-lg",
				children: toastMessage
			}, void 0, false, {
				fileName: _jsxFileName,
				lineNumber: 203,
				columnNumber: 9
			}, this),
			/* @__PURE__ */ _jsxDEV(AddUserModal, {
				isOpen: isAddUserOpen,
				onClose: () => setIsAddUserOpen(false),
				onUnauthorized: () => navigate("/admin/login"),
				onSaved: handleUserSaved
			}, void 0, false, {
				fileName: _jsxFileName,
				lineNumber: 208,
				columnNumber: 7
			}, this),
			/* @__PURE__ */ _jsxDEV(EditUserModal, {
				isOpen: isEditModalOpen,
				userId: editingUserId,
				user: selectedUser || { id: editingUserId },
				onClose: () => {
					setIsEditModalOpen(false);
					setEditingUserId(null);
					setSelectedUser(null);
				},
				onUnauthorized: () => navigate("/admin/login"),
				onSaved: handleUserSaved
			}, void 0, false, {
				fileName: _jsxFileName,
				lineNumber: 215,
				columnNumber: 7
			}, this)
		]
	}, void 0, true, {
		fileName: _jsxFileName,
		lineNumber: 153,
		columnNumber: 5
	}, this);
}
_s(Users, "rDoFyI6RNR3djWN9x0ZCD6nXLxM=", false, function() {
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

//# sourceMappingURL=data:application/json;base64,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LFNBQUQ7TUFBTyxXQUFVO2dCQUFqQixDQUNFLHdCQUFDLFFBQUQ7T0FBTSxXQUFVO2lCQUNkLHdCQUFDLFFBQUQsRUFBUSxNQUFNLEdBQUs7Ozs7O01BQ2Y7Ozs7Z0JBQ04sd0JBQUMsU0FBRDtPQUNFLE9BQU87T0FDUCxXQUFXLE1BQU0sU0FBUyxFQUFFLE9BQU8sS0FBSztPQUN4QyxhQUFZO09BQ1osV0FBVTtNQUNYOzs7O2NBQ0k7Ozs7O2FBQ0o7Ozs7O2NBQ0wsd0JBQUMsV0FBRDtLQUFvQjtLQUFTLE1BQU07S0FBd0I7SUFBVTs7OztZQUNsRTs7Ozs7O0dBRUosZ0JBQ0Msd0JBQUMsT0FBRDtJQUFLLFdBQVU7Y0FDWjtHQUNFOzs7OztHQUdQLHdCQUFDLGNBQUQ7SUFDRSxRQUFRO0lBQ1IsZUFBZSxpQkFBaUIsS0FBSztJQUNyQyxzQkFBc0IsU0FBUyxjQUFjO0lBQzdDLFNBQVM7R0FDVjs7Ozs7R0FFRCx3QkFBQyxlQUFEO0lBQ0UsUUFBUTtJQUNSLFFBQVE7SUFDUixNQUFNLGdCQUFnQixFQUFFLElBQUksY0FBYztJQUMxQyxlQUFlO0tBQ2IsbUJBQW1CLEtBQUs7S0FDeEIsaUJBQWlCLElBQUk7S0FDckIsZ0JBQWdCLElBQUk7SUFDdEI7SUFDQSxzQkFBc0IsU0FBUyxjQUFjO0lBQzdDLFNBQVM7R0FDVjs7Ozs7RUFDRTs7Ozs7O0FBRVQiLCJuYW1lcyI6W10sInNvdXJjZXMiOlsiVXNlcnMuanN4Il0sInZlcnNpb24iOjMsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHVzZUVmZmVjdCwgdXNlU3RhdGUgfSBmcm9tICdyZWFjdCdcclxuaW1wb3J0IHsgdXNlTmF2aWdhdGUgfSBmcm9tICdyZWFjdC1yb3V0ZXItZG9tJ1xyXG5pbXBvcnQgYXBpIGZyb20gJy4uLy4uL3NlcnZpY2VzL2FwaS5qcydcclxuaW1wb3J0IFBhZ2VIZWFkZXIgZnJvbSAnLi4vLi4vY29tcG9uZW50cy9QYWdlSGVhZGVyJ1xyXG5pbXBvcnQgU3RhdENhcmQgZnJvbSAnLi4vLi4vY29tcG9uZW50cy9TdGF0Q2FyZCdcclxuaW1wb3J0IERhdGFUYWJsZSBmcm9tICcuLi8uLi9jb21wb25lbnRzL0RhdGFUYWJsZSdcclxuaW1wb3J0IEFkZFVzZXJNb2RhbCBmcm9tICcuLi8uLi9jb21wb25lbnRzL3VzZXJzL0FkZFVzZXJNb2RhbC5qc3gnXHJcbmltcG9ydCBFZGl0VXNlck1vZGFsIGZyb20gJy4uLy4uL2NvbXBvbmVudHMvdXNlcnMvRWRpdFVzZXJNb2RhbC5qc3gnXHJcbmltcG9ydCB7IFNlYXJjaCwgUGx1cywgVXNlcnMgYXMgVXNlcnNJY29uLCBDaGVja0NpcmNsZTIsIENpcmNsZU9mZiB9IGZyb20gJ2x1Y2lkZS1yZWFjdCdcclxuXHJcbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIFVzZXJzKCkge1xyXG4gIGNvbnN0IG5hdmlnYXRlID0gdXNlTmF2aWdhdGUoKVxyXG4gIGNvbnN0IFt1c2Vycywgc2V0VXNlcnNdID0gdXNlU3RhdGUoW10pXHJcbiAgY29uc3QgW2xvYWRpbmcsIHNldExvYWRpbmddID0gdXNlU3RhdGUodHJ1ZSlcclxuICBjb25zdCBbZXJyb3IsIHNldEVycm9yXSA9IHVzZVN0YXRlKCcnKVxyXG4gIGNvbnN0IFtxdWVyeSwgc2V0UXVlcnldID0gdXNlU3RhdGUoJycpXHJcbiAgY29uc3QgW2lzQWRkVXNlck9wZW4sIHNldElzQWRkVXNlck9wZW5dID0gdXNlU3RhdGUoZmFsc2UpXHJcbiAgY29uc3QgW2lzRWRpdE1vZGFsT3Blbiwgc2V0SXNFZGl0TW9kYWxPcGVuXSA9IHVzZVN0YXRlKGZhbHNlKVxyXG4gIGNvbnN0IFtlZGl0aW5nVXNlcklkLCBzZXRFZGl0aW5nVXNlcklkXSA9IHVzZVN0YXRlKG51bGwpXHJcbiAgY29uc3QgW3NlbGVjdGVkVXNlciwgc2V0U2VsZWN0ZWRVc2VyXSA9IHVzZVN0YXRlKG51bGwpXHJcbiAgY29uc3QgW3RvYXN0TWVzc2FnZSwgc2V0VG9hc3RNZXNzYWdlXSA9IHVzZVN0YXRlKCcnKVxyXG5cclxuICBjb25zdCBoYW5kbGVPcGVuQWRkVXNlck1vZGFsID0gKCkgPT4ge1xyXG4gICAgc2V0RWRpdGluZ1VzZXJJZChudWxsKVxyXG4gICAgc2V0U2VsZWN0ZWRVc2VyKG51bGwpXHJcbiAgICBzZXRJc0FkZFVzZXJPcGVuKHRydWUpXHJcbiAgfVxyXG5cclxuICBjb25zdCBoYW5kbGVVc2VyU2F2ZWQgPSAoc2F2ZWRVc2VyKSA9PiB7XHJcbiAgICBpZiAoIXNhdmVkVXNlciB8fCAhc2F2ZWRVc2VyLmlkKSB7XHJcbiAgICAgIGZldGNoVXNlcnMoKVxyXG4gICAgICByZXR1cm5cclxuICAgIH1cclxuXHJcbiAgICBzZXRVc2VycygoZXhpc3RpbmdVc2VycykgPT4ge1xyXG4gICAgICBpZiAoZWRpdGluZ1VzZXJJZCkge1xyXG4gICAgICAgIHJldHVybiBleGlzdGluZ1VzZXJzLm1hcCgodXNlcikgPT4gKHVzZXIuaWQgPT09IHNhdmVkVXNlci5pZCA/IHNhdmVkVXNlciA6IHVzZXIpKVxyXG4gICAgICB9XHJcbiAgICAgIHJldHVybiBbc2F2ZWRVc2VyLCAuLi5leGlzdGluZ1VzZXJzXVxyXG4gICAgfSlcclxuXHJcbiAgICBzZXRUb2FzdE1lc3NhZ2UoZWRpdGluZ1VzZXJJZCA/ICdVc2VyIHVwZGF0ZWQgc3VjY2Vzc2Z1bGx5LicgOiAnVXNlciBjcmVhdGVkIHN1Y2Nlc3NmdWxseS4nKVxyXG4gICAgc2V0SXNBZGRVc2VyT3BlbihmYWxzZSlcclxuICAgIHNldElzRWRpdE1vZGFsT3BlbihmYWxzZSlcclxuICAgIHNldEVkaXRpbmdVc2VySWQobnVsbClcclxuICAgIHNldFNlbGVjdGVkVXNlcihudWxsKVxyXG4gICAgd2luZG93LnNldFRpbWVvdXQoKCkgPT4gc2V0VG9hc3RNZXNzYWdlKCcnKSwgNDAwMClcclxuICB9XHJcblxyXG4gIHVzZUVmZmVjdCgoKSA9PiB7XHJcbiAgICBmZXRjaFVzZXJzKClcclxuICB9LCBbXSlcclxuXHJcbiAgdXNlRWZmZWN0KCgpID0+IHtcclxuICAgIHdpbmRvdy5vcGVuRWRpdE1vZGFsID0gKGlkLCByb3cpID0+IHtcclxuICAgICAgaWYgKCFpZCkgcmV0dXJuXHJcbiAgICAgIHNldEVkaXRpbmdVc2VySWQoaWQpXHJcbiAgICAgIHNldFNlbGVjdGVkVXNlcihyb3cgfHwgbnVsbClcclxuICAgICAgc2V0SXNFZGl0TW9kYWxPcGVuKHRydWUpXHJcbiAgICB9XHJcbiAgICByZXR1cm4gKCkgPT4ge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGRlbGV0ZSB3aW5kb3cub3BlbkVkaXRNb2RhbFxyXG4gICAgICB9IGNhdGNoIChlcnIpIHt9XHJcbiAgICB9XHJcbiAgfSwgW10pXHJcblxyXG4gIGNvbnN0IGZldGNoVXNlcnMgPSBhc3luYyAoKSA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBzZXRMb2FkaW5nKHRydWUpXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXBpLmdldCgnL3VzZXJzLycpXHJcbiAgICAgIGNvbnN0IHJhd1VzZXJzID0gQXJyYXkuaXNBcnJheShyZXNwb25zZS5kYXRhKSA/IHJlc3BvbnNlLmRhdGEgOiByZXNwb25zZS5kYXRhLnJlc3VsdHMgfHwgW11cclxuICAgICAgY29uc3Qgbm9ybWFsaXplZFVzZXJzID0gcmF3VXNlcnMubWFwKCh1c2VyKSA9PiAoe1xyXG4gICAgICAgIC4uLnVzZXIsXHJcbiAgICAgICAgaWQ6IHVzZXI/LmlkID8/IHVzZXI/LnBrID8/IHVzZXI/LnVzZXJfaWQgPz8gdXNlcj8udXVpZCxcclxuICAgICAgfSkpXHJcbiAgICAgIHNldFVzZXJzKG5vcm1hbGl6ZWRVc2VycylcclxuICAgICAgc2V0RXJyb3IoJycpXHJcbiAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZmV0Y2hpbmcgdXNlcnM6JywgZXJyKVxyXG4gICAgICBzZXRFcnJvcignRmFpbGVkIHRvIGxvYWQgdXNlcnMuJylcclxuICAgIH0gZmluYWxseSB7XHJcbiAgICAgIHNldExvYWRpbmcoZmFsc2UpXHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBjb25zdCBmaWx0ZXJlZFVzZXJzID0gdXNlcnMuZmlsdGVyKCh1c2VyKSA9PiB7XHJcbiAgICBjb25zdCBrZXl3b3JkID0gcXVlcnkudG9Mb3dlckNhc2UoKVxyXG4gICAgcmV0dXJuIFt1c2VyLnVzZXJuYW1lLCB1c2VyLmVtYWlsLCB1c2VyLmZpcnN0X25hbWUsIHVzZXIubGFzdF9uYW1lLCB1c2VyLnN0dWRlbnRfaWRdXHJcbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcclxuICAgICAgLnNvbWUoKHZhbHVlKSA9PiBTdHJpbmcodmFsdWUpLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoa2V5d29yZCkpXHJcbiAgfSlcclxuXHJcbiAgY29uc3QgZ2V0VXNlcklkID0gKHJvdykgPT4gcm93Py5pZCA/PyByb3c/LnBrID8/IHJvdz8udXNlcl9pZCA/PyByb3c/LnV1aWRcclxuXHJcbiAgY29uc3QgY29sdW1ucyA9IFtcclxuICAgIHtcclxuICAgICAga2V5OiAnYWN0aW9ucycsXHJcbiAgICAgIGxhYmVsOiAnQWN0aW9ucycsXHJcbiAgICAgIGNsYXNzTmFtZTogJ3ctWzE0MHB4XSB0ZXh0LWxlZnQnLFxyXG4gICAgICByZW5kZXI6IChfdmFsdWUsIHJvdykgPT4ge1xyXG4gICAgICAgIGNvbnN0IGlkID0gZ2V0VXNlcklkKHJvdylcclxuICAgICAgICByZXR1cm4gKFxyXG4gICAgICAgICAgPGJ1dHRvblxyXG4gICAgICAgICAgICB0eXBlPVwiYnV0dG9uXCJcclxuICAgICAgICAgICAgZGF0YS11c2VyLWlkPXtpZCB8fCAnJ31cclxuICAgICAgICAgICAgb25DbGljaz17KGUpID0+IHtcclxuICAgICAgICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpXHJcbiAgICAgICAgICAgICAgaWYgKGlkICE9IG51bGwpIHtcclxuICAgICAgICAgICAgICAgIHNldEVkaXRpbmdVc2VySWQoaWQpXHJcbiAgICAgICAgICAgICAgICBzZXRTZWxlY3RlZFVzZXIocm93KVxyXG4gICAgICAgICAgICAgICAgc2V0SXNFZGl0TW9kYWxPcGVuKHRydWUpXHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9fVxyXG4gICAgICAgICAgICBjbGFzc05hbWU9XCJyb3VuZGVkLWZ1bGwgYmctYmx1ZS02MDAgcHgtNCBweS0xLjUgdGV4dC1zbSBmb250LXNlbWlib2xkIHRleHQtd2hpdGUgc2hhZG93LXNtIHRyYW5zaXRpb24gaG92ZXI6YmctYmx1ZS03MDBcIlxyXG4gICAgICAgICAgPlxyXG4gICAgICAgICAgICBFZGl0IFVzZXJcclxuICAgICAgICAgIDwvYnV0dG9uPlxyXG4gICAgICAgIClcclxuICAgICAgfSxcclxuICAgIH0sXHJcbiAgICB7IGtleTogJ3N0dWRlbnRfaWQnLCBsYWJlbDogJ1N0dWRlbnQgSUQnIH0sXHJcbiAgICB7IGtleTogJ3VzZXJuYW1lJywgbGFiZWw6ICdVc2VybmFtZScgfSxcclxuICAgIHtcclxuICAgICAga2V5OiAnbmFtZScsXHJcbiAgICAgIGxhYmVsOiAnTmFtZScsXHJcbiAgICAgIGNsYXNzTmFtZTogJ21pbi13LVsyNDBweF0nLFxyXG4gICAgICByZW5kZXI6IChfdmFsdWUsIHJvdykgPT4ge1xyXG4gICAgICAgIGNvbnN0IGZ1bGxOYW1lID0gYCR7cm93LmZpcnN0X25hbWUgfHwgJyd9ICR7cm93Lmxhc3RfbmFtZSB8fCAnJ31gLnRyaW0oKSB8fCAn4oCUJ1xyXG4gICAgICAgIHJldHVybiA8c3BhbiBjbGFzc05hbWU9XCJ0ZXh0LXNtIHRleHQtWyMxMTE4MjddXCI+e2Z1bGxOYW1lfTwvc3Bhbj5cclxuICAgICAgfSxcclxuICAgIH0sXHJcbiAgICB7IGtleTogJ2VtYWlsJywgbGFiZWw6ICdFbWFpbCcgfSxcclxuICAgIHsga2V5OiAncm9sZScsIGxhYmVsOiAnUm9sZScgfSxcclxuICAgIHsga2V5OiAnc2VjdGlvbicsIGxhYmVsOiAnU2VjdGlvbicgfSxcclxuICAgIHtcclxuICAgICAga2V5OiAnc3RhdHVzJyxcclxuICAgICAgbGFiZWw6ICdTdGF0dXMnLFxyXG4gICAgICByZW5kZXI6IChfdmFsdWUsIHJvdykgPT4gKFxyXG4gICAgICAgIDxzcGFuIGNsYXNzTmFtZT17YGlubGluZS1mbGV4IGl0ZW1zLWNlbnRlciBnYXAtMSByb3VuZGVkLWZ1bGwgcHgtMyBweS0xIHRleHQteHMgZm9udC1zZW1pYm9sZCAke3Jvdy5pc19hY3RpdmUgPyAnYmctWyNFQ0ZERjNdIHRleHQtWyMxNkEzNEFdJyA6ICdiZy1bI0ZFRjJGMl0gdGV4dC1bI0RDMjYyNl0nfWB9PlxyXG4gICAgICAgICAge3Jvdy5pc19hY3RpdmUgPyA8Q2hlY2tDaXJjbGUyIHNpemU9ezEyfSAvPiA6IDxDaXJjbGVPZmYgc2l6ZT17MTJ9IC8+fVxyXG4gICAgICAgICAge3Jvdy5pc19hY3RpdmUgPyAnQWN0aXZlJyA6ICdJbmFjdGl2ZSd9XHJcbiAgICAgICAgPC9zcGFuPlxyXG4gICAgICApLFxyXG4gICAgfSxcclxuICBdXHJcblxyXG4gIGNvbnN0IHRvdGFsVXNlcnMgPSB1c2Vycy5sZW5ndGhcclxuICBjb25zdCBhY3RpdmVVc2VycyA9IHVzZXJzLmZpbHRlcigodXNlcikgPT4gdXNlci5pc19hY3RpdmUpLmxlbmd0aFxyXG4gIGNvbnN0IGluYWN0aXZlVXNlcnMgPSB0b3RhbFVzZXJzIC0gYWN0aXZlVXNlcnNcclxuXHJcbiAgcmV0dXJuIChcclxuICAgIDxkaXYgY2xhc3NOYW1lPVwic3BhY2UteS04XCI+XHJcbiAgICAgIDxQYWdlSGVhZGVyXHJcbiAgICAgICAgdGl0bGU9XCJVc2VycyBNYW5hZ2VtZW50XCJcclxuICAgICAgICBkZXNjcmlwdGlvbj1cIk1hbmFnZSBzeXN0ZW0gdXNlcnMsIHJvbGVzLCBhbmQgcGVybWlzc2lvbnNcIlxyXG4gICAgICAgIGFjdGlvbj17XHJcbiAgICAgICAgICA8YnV0dG9uXHJcbiAgICAgICAgICAgIHR5cGU9XCJidXR0b25cIlxyXG4gICAgICAgICAgICBvbkNsaWNrPXtoYW5kbGVPcGVuQWRkVXNlck1vZGFsfVxyXG4gICAgICAgICAgICBjbGFzc05hbWU9XCJmbGV4IGl0ZW1zLWNlbnRlciBnYXAtMiByb3VuZGVkLVsxMHB4XSBiZy1bIzI1NjNFQl0gcHgtNCBweS0yIHRleHQtc20gZm9udC1zZW1pYm9sZCB0ZXh0LXdoaXRlIHNoYWRvdy1zbSB0cmFuc2l0aW9uIGhvdmVyOmJnLVsjMUQ0RUQ4XVwiXHJcbiAgICAgICAgICA+XHJcbiAgICAgICAgICAgIDxQbHVzIHNpemU9ezE2fSAvPlxyXG4gICAgICAgICAgICBBZGQgVXNlclxyXG4gICAgICAgICAgPC9idXR0b24+XHJcbiAgICAgICAgfVxyXG4gICAgICAvPlxyXG5cclxuICAgICAgPGRpdiBjbGFzc05hbWU9XCJncmlkIGdhcC02IG1kOmdyaWQtY29scy0zXCI+XHJcbiAgICAgICAgPFN0YXRDYXJkIGljb249ezxVc2Vyc0ljb24gc2l6ZT17MTh9IC8+fSBsYWJlbD1cIlRvdGFsIFVzZXJzXCIgdmFsdWU9e3RvdGFsVXNlcnN9IHN1YnRpdGxlPVwiQWxsIHJlZ2lzdGVyZWQgYWNjb3VudHNcIiAvPlxyXG4gICAgICAgIDxTdGF0Q2FyZCBpY29uPXs8Q2hlY2tDaXJjbGUyIHNpemU9ezE4fSAvPn0gbGFiZWw9XCJBY3RpdmVcIiB2YWx1ZT17YWN0aXZlVXNlcnN9IHN1YnRpdGxlPVwiQ3VycmVudGx5IGFjdGl2ZVwiIC8+XHJcbiAgICAgICAgPFN0YXRDYXJkIGljb249ezxDaXJjbGVPZmYgc2l6ZT17MTh9IC8+fSBsYWJlbD1cIkluYWN0aXZlXCIgdmFsdWU9e2luYWN0aXZlVXNlcnN9IHN1YnRpdGxlPVwiUGVuZGluZyByZXZpZXdcIiAvPlxyXG4gICAgICA8L2Rpdj5cclxuXHJcbiAgICAgIHtlcnJvciAmJiAoXHJcbiAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJyb3VuZGVkLVsxMnB4XSBib3JkZXIgYm9yZGVyLVsjRkVDQUNBXSBiZy1bI0ZFRjJGMl0gcHgtNCBweS0zIHRleHQtc20gdGV4dC1bI0RDMjYyNl1cIj5cclxuICAgICAgICAgIHtlcnJvcn1cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgKX1cclxuXHJcbiAgICAgIDxkaXYgY2xhc3NOYW1lPVwicm91bmRlZC1bMTJweF0gYm9yZGVyIGJvcmRlci1bI0U1RTdFQl0gYmctd2hpdGUgcC02IHNoYWRvdy1zbVwiPlxyXG4gICAgICAgIDxkaXYgY2xhc3NOYW1lPVwibWItNCBmbGV4IGZsZXgtY29sIGdhcC00IG1kOmZsZXgtcm93IG1kOml0ZW1zLWNlbnRlciBtZDpqdXN0aWZ5LWJldHdlZW5cIj5cclxuICAgICAgICAgIDxkaXY+XHJcbiAgICAgICAgICAgIDxoMiBjbGFzc05hbWU9XCJ0ZXh0LWxnIGZvbnQtc2VtaWJvbGQgdGV4dC1bIzExMTgyN11cIj5Vc2VyIERpcmVjdG9yeTwvaDI+XHJcbiAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cInRleHQtc20gdGV4dC1bIzZCNzI4MF1cIj5Ccm93c2UgcmVnaXN0ZXJlZCB1c2VycyBhbmQgdGhlaXIgcm9sZXMuPC9wPlxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICA8bGFiZWwgY2xhc3NOYW1lPVwicmVsYXRpdmUgYmxvY2sgdy1mdWxsIG1kOnctWzMyMHB4XVwiPlxyXG4gICAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9XCJwb2ludGVyLWV2ZW50cy1ub25lIGFic29sdXRlIGluc2V0LXktMCBsZWZ0LTMgZmxleCBpdGVtcy1jZW50ZXIgdGV4dC1bIzZCNzI4MF1cIj5cclxuICAgICAgICAgICAgICA8U2VhcmNoIHNpemU9ezE2fSAvPlxyXG4gICAgICAgICAgICA8L3NwYW4+XHJcbiAgICAgICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgICAgIHZhbHVlPXtxdWVyeX1cclxuICAgICAgICAgICAgICBvbkNoYW5nZT17KGUpID0+IHNldFF1ZXJ5KGUudGFyZ2V0LnZhbHVlKX1cclxuICAgICAgICAgICAgICBwbGFjZWhvbGRlcj1cIlNlYXJjaCB1c2Vycy4uLlwiXHJcbiAgICAgICAgICAgICAgY2xhc3NOYW1lPVwiaC0xMCB3LWZ1bGwgcm91bmRlZC1bMTBweF0gYm9yZGVyIGJvcmRlci1bI0QxRDVEQl0gYmctd2hpdGUgcGwtOSBwci0zIHRleHQtc20gdGV4dC1bIzM3NDE1MV0gb3V0bGluZS1ub25lIGZvY3VzOmJvcmRlci1bIzI1NjNFQl1cIlxyXG4gICAgICAgICAgICAvPlxyXG4gICAgICAgICAgPC9sYWJlbD5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8RGF0YVRhYmxlIGNvbHVtbnM9e2NvbHVtbnN9IGRhdGE9e2ZpbHRlcmVkVXNlcnN9IGxvYWRpbmc9e2xvYWRpbmd9IC8+XHJcbiAgICAgIDwvZGl2PlxyXG5cclxuICAgICAge3RvYXN0TWVzc2FnZSAmJiAoXHJcbiAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJmaXhlZCBib3R0b20tNiByaWdodC02IHotNTAgcm91bmRlZC1bMTRweF0gYm9yZGVyIGJvcmRlci1bI0QxRkFFNV0gYmctWyNFQ0ZERjVdIHB4LTUgcHktNCB0ZXh0LXNtIHRleHQtWyMwNjVGNDZdIHNoYWRvdy1sZ1wiPlxyXG4gICAgICAgICAge3RvYXN0TWVzc2FnZX1cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgKX1cclxuXHJcbiAgICAgIDxBZGRVc2VyTW9kYWxcclxuICAgICAgICBpc09wZW49e2lzQWRkVXNlck9wZW59XHJcbiAgICAgICAgb25DbG9zZT17KCkgPT4gc2V0SXNBZGRVc2VyT3BlbihmYWxzZSl9XHJcbiAgICAgICAgb25VbmF1dGhvcml6ZWQ9eygpID0+IG5hdmlnYXRlKCcvYWRtaW4vbG9naW4nKX1cclxuICAgICAgICBvblNhdmVkPXtoYW5kbGVVc2VyU2F2ZWR9XHJcbiAgICAgIC8+XHJcblxyXG4gICAgICA8RWRpdFVzZXJNb2RhbFxyXG4gICAgICAgIGlzT3Blbj17aXNFZGl0TW9kYWxPcGVufVxyXG4gICAgICAgIHVzZXJJZD17ZWRpdGluZ1VzZXJJZH1cclxuICAgICAgICB1c2VyPXtzZWxlY3RlZFVzZXIgfHwgeyBpZDogZWRpdGluZ1VzZXJJZCB9fVxyXG4gICAgICAgIG9uQ2xvc2U9eygpID0+IHtcclxuICAgICAgICAgIHNldElzRWRpdE1vZGFsT3BlbihmYWxzZSlcclxuICAgICAgICAgIHNldEVkaXRpbmdVc2VySWQobnVsbClcclxuICAgICAgICAgIHNldFNlbGVjdGVkVXNlcihudWxsKVxyXG4gICAgICAgIH19XHJcbiAgICAgICAgb25VbmF1dGhvcml6ZWQ9eygpID0+IG5hdmlnYXRlKCcvYWRtaW4vbG9naW4nKX1cclxuICAgICAgICBvblNhdmVkPXtoYW5kbGVVc2VyU2F2ZWR9XHJcbiAgICAgIC8+XHJcbiAgICA8L2Rpdj5cclxuICApXHJcbn1cclxuIl19