import UserFormWorkflow from './UserFormWorkflow.jsx'

export default function AddUserModal(props) {
  return <UserFormWorkflow {...props} mode={props.userId ? 'edit' : 'create'} />
}
