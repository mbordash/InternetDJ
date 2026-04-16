// context/AuthContext.js
import React, { createContext, useState, useEffect } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchUser = async () => {
            const token = localStorage.getItem('token');
            console.log('AuthContext token:', token); // Debug token
            if (token) {
                try {
                    const response = await axios.get(`${API_URL}/auth/me`, {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    console.log('AuthContext user:', response.data); // Debug user data
                    setUser(response.data);
                } catch (err) {
                    console.error(
                        'Error fetching user:',
                        err.response?.status,
                        err.response?.data?.error || err.message
                    );
                    if (err.response?.status === 401 || err.response?.status === 403) {
                        localStorage.removeItem('token'); // Clear invalid token
                    }
                }
            }
            setLoading(false);
        };

        fetchUser();
    }, []);

    return (
        <AuthContext.Provider value={{ user, setUser, loading }}>
            {children}
        </AuthContext.Provider>
    );
};