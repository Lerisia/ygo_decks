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

// Daily login bonus — call once on app load when authenticated.
export interface PointTransaction {
  id: number;
  amount: number;
  kind: string;
  kind_label: string;
  display_label: string;
  note: string;
  balance_after: number;
  created_at: string;
}

export interface PointHistoryPage {
  results: PointTransaction[];
  count: number;
  page: number;
  page_size: number;
  has_next: boolean;
}

export interface AdminUserHit {
  id: number;
  username: string;
  points: number;
}

export const adminSearchUsers = async (q: string): Promise<AdminUserHit[]> => {
  const token = localStorage.getItem("access_token") || "";
  const res = await fetch(`/api/manage/users/search/?q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const body = await res.json();
  return body.results || [];
};

export const adminGrantPoints = async (
  username: string,
  amount: number,
  note: string,
): Promise<{ ok: boolean; user: { id: number; username: string; points: number }; amount: number; note: string }> => {
  const token = localStorage.getItem("access_token") || "";
  const res = await fetch("/api/manage/points/grant/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ username, amount, note }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body && (body.error || body.detail)) || "지급 실패");
  return body;
};

export const getPointsHistory = async (page = 1, pageSize = 50): Promise<PointHistoryPage | null> => {
  const token = localStorage.getItem("access_token");
  if (!token) return null;
  const res = await fetch(`/api/user/points/history/?page=${page}&page_size=${pageSize}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
};

export const claimDailyBonus = async (): Promise<{
  claimed: boolean;
  points_added: number;
  points: number;
} | null> => {
  const token = localStorage.getItem("access_token");
  if (!token) return null;
  const response = await fetch("/api/daily-bonus/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) return null;
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

// Check if currently logged in user is admin
export const isAdmin = async () => {
    const response = await fetch("/api/is_admin/", {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("access_token")}`,
      },
    });
    const data = await response.json();
    return data.is_admin;
  };
  