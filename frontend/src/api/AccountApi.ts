// Register API
export const register = async (username: string, password: string) => {
    const response = await fetch(`/api/auth/register/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
    });

    return response.json();
};

// Login API (JWT)
export const login = async (username: string, password: string) => {
    const response = await fetch(`/api/auth/token/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
    });

    const data = await response.json();
    if (response.ok) {
        localStorage.setItem("access_token", data.access);
        localStorage.setItem("refresh_token", data.refresh);
    }
    return data;
};

// Logout
export const logout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
};

// Check login status
export const isAuthenticated = () => {
    return Boolean(localStorage.getItem("access_token"));
};
