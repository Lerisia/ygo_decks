// Register API
export const register = async (email: string, username: string, password1: string, password2: string) => {
    const response = await fetch(`/api/auth/register/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username, password1, password2 }),
    });

    return response.json();
};

// E-mail duplication check
export const checkEmailExists = async (email: string): Promise<boolean> => {
    try {
        const response = await fetch(`/api/check-email/?email=${encodeURIComponent(email)}`);
        const data = await response.json();
        return data.exists;
    } catch (error) {
        return false;
    }
};

// username duplication check
export const checkUsernameExists = async (username: string): Promise<boolean> => {
    try {
        const response = await fetch(`/api/check-username/?username=${encodeURIComponent(username)}`);
        const data = await response.json();
        return data.exists;
    } catch (error) {
        return false;
    }
};

// Login API (JWT)
export const login = async (email: string, password: string) => {   
    const response = await fetch("/api/token/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  
    const data = await response.json();
    if (response.ok) {
      localStorage.setItem("access_token", data.access);
      localStorage.setItem("refresh_token", data.refresh);
    }
    return data;
  };

// Logout
export const logout = async () => {
    const refreshToken = localStorage.getItem("refresh_token");

    if (refreshToken) {
        await fetch("/api/token/logout/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh: refreshToken }),
        });
    }

    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
};
// Check login status
export const isAuthenticated = () => {
    return Boolean(localStorage.getItem("access_token"));
};