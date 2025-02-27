import React from "react";
import { Link } from "react-router-dom";

const isDarkMode = window.matchMedia("(prefers-color-scheme: dark)").matches;

const Footer: React.FC = () => {
  return (
    <footer style={styles.footer}>
      <p>© KONAMI. All Yu-Gi-Oh! related images and materials are the property of KONAMI.</p>
      <p>
      This website is an unofficial fan site and is not affiliated with or endorsed by KONAMI in any way.
      </p>
      <p>All images on this website belong to KONAMI and are used solely for informational purposes.</p>
      
      <Link to="/terms" style={styles.link}>이용약관</Link>
    </footer>
  );
};

const styles = {
    footer: {
      textAlign: "center" as const,
      padding: "20px",
      marginTop: "40px",
    },
    text: {
      color: isDarkMode ? "#fff" : "#444",
      fontSize: "14px",
    },
    link: {
      color: isDarkMode ? "#bbb" : "#666",
      textDecoration: "none",
      fontWeight: "bold",
    },
  };
  

export default Footer;
