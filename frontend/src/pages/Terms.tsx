const Terms = () => {
  return (
    <div className="min-h-screen px-4 py-6 max-w-3xl mx-auto text-gray-800 dark:text-gray-200 leading-relaxed">
      <h2 className="text-2xl font-bold text-center mb-6">Terms of Use</h2>

      <p>This website provides deck recommendations and analysis for Yu-Gi-Oh! Master Duel.</p>
      <p>All content and functionality are intended for personal, non-commercial use only.</p>

      <h3 className="text-lg font-bold mt-6 mb-2">Prohibited Commercial Use</h3>
      <p>The following actions are strictly prohibited without prior written permission:</p>
      <ul className="list-disc pl-5">
        <li>Using the content, images, data, or functionalities of this website for commercial purposes.</li>
        <li>Embedding this website within another site (iframe usage) for financial gain.</li>
        <li>Automated data scraping, web crawling, or bulk extraction of data from this website.</li>
      </ul>

      <h3 className="text-lg font-bold mt-6 mb-2">Copyright & Ownership</h3>
      <p>All Yu-Gi-Oh! related images, trademarks, and assets are the property of KONAMI.</p>
      <p>This website is an unofficial fan site and does not claim ownership of any KONAMI content.</p>

      <h3 className="text-lg font-bold mt-6 mb-2">Consequences of Violation</h3>
      <p>Any violation of these terms may result in legal action, including but not limited to:</p>
      <ul className="list-disc pl-5">
        <li>DMCA takedown requests for infringing content.</li>
        <li>Reporting unauthorized sites to hosting providers.</li>
      </ul>

      <h3 className="text-lg font-bold mt-6 mb-2">Contact</h3>
      <p>
        If you wish to request permission for any usage beyond personal use, please contact us at{" "}
        <a href="mailto:rlawodus96@gmail.com" className="text-blue-500 hover:underline">rlawodus96@gmail.com</a>.
      </p>
    </div>
  );
};

export default Terms;
