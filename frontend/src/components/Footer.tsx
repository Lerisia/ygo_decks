import { Link } from "react-router-dom";

const Footer = () => {
  return (
    <footer className="text-center px-4 py-5 mt-10 text-xs text-gray-500 dark:text-gray-400">
      <p>© KONAMI. All Yu-Gi-Oh! related images and materials are the property of KONAMI.</p>
      <p>This website is an unofficial fan site and is not affiliated with or endorsed by KONAMI in any way.</p>
      <p>All images on this website belong to KONAMI and are used solely for informational purposes.</p>
      <Link to="/terms" className="inline-block mt-2 font-bold text-gray-600 dark:text-gray-300 hover:underline">
        이용약관
      </Link>
    </footer>
  );
};

export default Footer;
