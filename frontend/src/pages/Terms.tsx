import React from "react";

const Terms: React.FC = () => {
  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Terms of Use</h2>

      <p>This website provides deck recommendations and analysis for Yu-Gi-Oh! Master Duel.</p>
      <p>All content and functionality are intended for personal, non-commercial use only.</p>

      <h3 style={styles.subtitle}>Prohibited Commercial Use</h3>
      <p>The following actions are strictly prohibited without prior written permission:</p>
      <ul style={styles.list}>
        <li>Using the content, images, data, or functionalities of this website for commercial purposes.</li>
        <li>Embedding this website within another site (iframe usage) for financial gain.</li>
        <li>Automated data scraping, web crawling, or bulk extraction of data from this website.</li>
      </ul>

      <h3 style={styles.subtitle}>Copyright & Ownership</h3>
      <p>All Yu-Gi-Oh! related images, trademarks, and assets are the property of KONAMI.</p>
      <p>This website is an unofficial fan site and does not claim ownership of any KONAMI content.</p>

      <h3 style={styles.subtitle}>Consequences of Violation</h3>
      <p>Any violation of these terms may result in legal action, including but not limited to:</p>
      <ul style={styles.list}>
        <li>DMCA takedown requests for infringing content.</li>
        <li>Reporting unauthorized sites to hosting providers.</li>
      </ul>

      <h3 style={styles.subtitle}>Contact</h3>
      <p>
        If you wish to request permission for any usage beyond personal use, please contact us at{" "}
        <a href="rlawodus96@gmail.com" style={styles.link}>rlawodus96@gmail.com</a>.
      </p>
    </div>
  );
};

// 스타일 정의
const styles = {
  container: {
    padding: "40px 20px", // 상단 여백 추가
    maxWidth: "800px",
    margin: "0 auto",
    textAlign: "left" as const, // 왼쪽 정렬 유지
    lineHeight: "1.6", // 가독성을 위한 줄 간격 조절
    fontSize: "16px", // 기본 글씨 크기 조절
    color: "#333", // 기본 글씨 색상 (너무 연하지 않게)
  },
  title: {
    fontSize: "28px",
    fontWeight: "bold" as const,
    textAlign: "center" as const, // 제목은 가운데 정렬
    marginBottom: "20px",
  },
  subtitle: {
    fontSize: "20px",
    fontWeight: "bold" as const,
    marginTop: "30px", // 위쪽 간격 추가
    marginBottom: "10px", // 소제목과 본문 사이 간격 추가
  },
  list: {
    paddingLeft: "20px", // 리스트 항목 들여쓰기
  },
  link: {
    color: "#007bff", // 이메일 링크를 눈에 띄게
    textDecoration: "none",
  },
};

export default Terms;
