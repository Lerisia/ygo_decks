import React from "react";
import { Link } from "react-router-dom";

const NotFound: React.FC = () => {
  return (
    <div className="px-4 text-center">
      <h1 className="text-5xl font-extrabold text-gray-800 md:text-7xl">404 Not Found</h1>
      <p className="mt-2 text-lg text-gray-600 md:text-xl">
        Oops! The page you are looking for does not exist.
      </p>

      <img
        src="/images/SForceChase-MADU-EN-VG-artwork.png"
        alt="s-force_chase"
        className="mt-6 mx-auto w-48 sm:w-56 md:w-64 lg:w-72 max-w-full"
      />

      <p className="mt-6">
        <Link to="/" className="text-blue-500 hover:underline">
          홈으로 돌아가기
        </Link>
      </p>
    </div>
  );
};

export default NotFound;
