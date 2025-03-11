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

// Username duplication check
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
    }
    return data;
};

// Logout
export const logout = () => {
    localStorage.removeItem("access_token");
    window.location.href = "/login";
};

// Check login status
export const isAuthenticated = () => {
    return Boolean(localStorage.getItem("access_token"));
};

// Change username
export const changeUsername = async (newUsername: string) => {
    const token = localStorage.getItem("access_token");

    const response = await fetch(`/api/change-username/`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ username: newUsername }),
    });

    return response.json();
};

// Change password
export const changePassword = async (currentPassword: string, newPassword: string) => {
    const token = localStorage.getItem("access_token");

    const response = await fetch(`/api/change-password/`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });

    return response.json();
};

// Get user info
export const getUserInfo = async () => {
    const token = localStorage.getItem("access_token");
  
    const response = await fetch("/api/user-info/", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
  
    if (!response.ok) return null;
    return await response.json();
  };
  

// Get owned decks
export const getUserDecks = async () => {
    const token = localStorage.getItem("access_token");

    const response = await fetch("/api/user-decks/", {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
    });
    return response.json();
};

// Updated owned decks
export const updateUserDecks = async (deckIds: number[]) => {
    const token = localStorage.getItem("access_token");

    const response = await fetch("/api/user-decks/update/", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ deck_ids: deckIds }),
    });
    return response.json();
};

// Update user setting (currently only custom deck recommendation)
export const updateUserSettings = async (useCustomLookup: boolean) => {
    const token = localStorage.getItem("access_token");
    const response = await fetch("/api/user/update-settings/", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ use_custom_lookup: useCustomLookup }),
    });
    return response.json();
};
