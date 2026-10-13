import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { isAdmin } from "@/api/accountApi";

/** For pages only operators may open: false until the server says this is an operator; anyone else, or an answer
 *  that fails, is sent to the home page. */
export function useAdminOnly() {
  const navigate = useNavigate();
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    const away = () => alive && navigate("/", { replace: true });
    isAdmin()
      .then((flag) => (flag ? alive && setOk(true) : away()))
      .catch(away);
    return () => {
      alive = false;
    };
  }, [navigate]);
  return ok;
}
