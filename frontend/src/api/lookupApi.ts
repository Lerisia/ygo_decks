export const fetchLookupTable = async () => {
  try {
    const token = localStorage.getItem("access_token");
    const headers: HeadersInit = token
      ? { "Authorization": `Bearer ${token}` }
      : {};  // If not logged in

    const response = await fetch("/api/get_lookup_table/", { headers });

    if (!response.ok) {
      throw new Error("Failed to fetch lookup table.");
    }

    const data = await response.json();
    return data.lookup_table;
  } catch (error) {
    console.error("Look-up Table 가져오기 실패:", error);
    return null;
  }
};
