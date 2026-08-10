import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function StaffRoute({ children }) {
    const { user } = useAuth();
    if (user?.account_type !== 'staff') return <Navigate to="/" replace />;
    return children;
}
