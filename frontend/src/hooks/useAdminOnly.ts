import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { isAdmin } from "@/api/accountApi";

/** For pages only operators may open: false until the server says this is an operator; anyone else, or an answer
 *  that fails, is sent to the home page. With enabled false (a page that is operators-only in one of its uses) it
 *  lets everyone in at once. */
export function useAdminOnly(enabled = true) {
  const navigate = useNavigate();
  const [ok, setOk] = useState(!enabled);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const away = () => alive && navigate("/", { replace: true });
    isAdmin()
      .then((flag) => (flag ? alive && setOk(true) : away()))
      .catch(away);
    return () => {
      alive = false;
    };
  }, [navigate, enabled]);
  return ok;
}
