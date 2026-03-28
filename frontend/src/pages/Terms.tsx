const Terms = () => {
  return (
    <div className="min-h-screen px-4 py-6 max-w-3xl mx-auto text-gray-800 dark:text-gray-200 leading-relaxed">
      <h2 className="text-2xl font-bold text-center mb-6">Terms of Use & Privacy Policy</h2>

      <p>This website and app ("YGODecks") provides deck recommendations, match record tracking, and analysis for Yu-Gi-Oh! Master Duel.</p>
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

      <h3 className="text-lg font-bold mt-8 mb-2">Privacy Policy</h3>

      <h4 className="font-bold mt-4 mb-1">Information We Collect</h4>
      <ul className="list-disc pl-5">
        <li><strong>Account information:</strong> Email address and username when you register.</li>
        <li><strong>Match records:</strong> Game results, deck choices, and related statistics you voluntarily submit.</li>
        <li><strong>Uploaded images:</strong> Card or deck list images submitted for AI analysis, automatically deleted after 7 days.</li>
      </ul>

      <h4 className="font-bold mt-4 mb-1">How We Use Your Information</h4>
      <ul className="list-disc pl-5">
        <li>To provide personalized deck recommendations and match statistics.</li>
        <li>To generate aggregated, anonymous meta-deck statistics.</li>
        <li>To improve the service.</li>
      </ul>

      <h4 className="font-bold mt-4 mb-1">What We Do NOT Do</h4>
      <ul className="list-disc pl-5">
        <li>We do not sell, share, or transfer your personal data to third parties.</li>
        <li>We do not use cookies for advertising or tracking purposes.</li>
        <li>We do not collect location data, contacts, or device identifiers.</li>
      </ul>

      <h4 className="font-bold mt-4 mb-1">Data Retention</h4>
      <ul className="list-disc pl-5">
        <li>Account data is retained as long as your account exists.</li>
        <li>Uploaded images are automatically deleted after 7 days.</li>
        <li>Unverified accounts are deleted after 48 hours.</li>
      </ul>

      <h4 className="font-bold mt-4 mb-1">Your Rights</h4>
      <p>You may request deletion of your account and associated data by contacting us.</p>

      <h3 className="text-lg font-bold mt-8 mb-2">Contact</h3>
      <p>
        For any inquiries, please contact us at{" "}
        <a href="mailto:rlawodus96@gmail.com" className="text-blue-500 hover:underline">rlawodus96@gmail.com</a>.
      </p>
    </div>
  );
};

export default Terms;
