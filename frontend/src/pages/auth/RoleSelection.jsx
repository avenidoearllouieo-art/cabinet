import { useNavigate } from "react-router-dom"

export default function RoleSelection() {
  const navigate = useNavigate()

  const roles = [
    { name: "Admin", route: "/admin/login" },
    { name: "Instructor", route: "/instructor/login" },
    { name: "Student", route: "/student/login" },
  ]

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="bg-white shadow-lg rounded-2xl p-8 w-full max-w-md">
        <div className="w-20 h-20 bg-gray-300 rounded-full mx-auto mb-4"></div>
        <h1 className="text-3xl font-bold text-center">TapTrack</h1>
        <p className="text-center text-gray-500 mb-8">IoT-Based Activity Cabinet Management System</p>
        <div className="space-y-4">
          {roles.map((role) => (
            <div
              key={role.name}
              onClick={() => navigate(role.route)}
              className="p-4 border rounded-xl cursor-pointer hover:bg-gray-100 hover:shadow transition"
            >
              <h2 className="text-lg font-semibold">{role.name}</h2>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
