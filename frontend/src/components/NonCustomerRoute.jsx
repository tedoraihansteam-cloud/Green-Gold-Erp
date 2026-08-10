import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function NonCustomerRoute({ children }) {
    const { user } = useAuth();
    if (user?.account_type === 'customer') {
        return <Navigate to="/customer-portal" replace />;
    }
    return children;
}
