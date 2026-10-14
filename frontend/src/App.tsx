import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { lazyChunk } from "@/lib/lazyChunk";
import { DECK_EDITOR_ROOM, isDeckEditorPath } from "@/lib/deckListPaths";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import './App.css'
import Navbar from "./components/Navbar";
import BottomTabBar from "./components/BottomTabBar";
import { useDrawingMode } from "./lib/drawingMode";
import TrackerBanner from "./components/TrackerBanner";
import TrackerConfirmModal from "./components/TrackerConfirmModal";
import Footer from "./components/Footer";
import Info from "./pages/Info";
import { usePageTracking } from "./hooks/usePageTracking";
import { useScrollRestoration } from "./hooks/useScrollRestoration";
import NoticePopup from "./components/NoticePopup";
import StaffInquiryAlert from "./components/StaffInquiryAlert";
import TournamentNoticePopup from "./components/TournamentNoticePopup";

// Every page but the home page is fetched when it is first opened (2026-10-12, 엘리스: the site was one 1.5 MB
// bundle, so opening a card page also fetched the charts, the markdown editor, the tier list maker and the games).
const Recommend = lazyChunk(() => import("./pages/Recommend"));
const QuestionPage = lazyChunk(() => import("./pages/QuestionPage"));
const ResultPage = lazyChunk(() => import("./pages/ResultPage"));
const Terms = lazyChunk(() => import("./pages/Terms"));
const NotFound = lazyChunk(() => import("./pages/NotFound"));
const Unauthorized = lazyChunk(() => import("./pages/Unauthorized"));
const Register = lazyChunk(() => import("./pages/Register"));
const Login = lazyChunk(() => import("./pages/Login"));
const Mypage = lazyChunk(() => import("./pages/Mypage"));
const PointsHistory = lazyChunk(() => import("./pages/PointsHistory"));
const NotificationHistory = lazyChunk(() => import("./pages/NotificationHistory"));
const AdminPointsGrant = lazyChunk(() => import("./pages/AdminPointsGrant"));
const AdminAnalytics = lazyChunk(() => import("./pages/AdminAnalytics"));
const AdminCharts = lazyChunk(() => import("./pages/AdminCharts"));
const AdminIndex = lazyChunk(() => import("./pages/AdminIndex"));
const Mydecks = lazyChunk(() => import("./pages/Mydecks"));
const Noresults = lazyChunk(() => import("./pages/Noresults"));
const DatabasePage = lazyChunk(() => import("./pages/Database"));
const DeckDetail = lazyChunk(() => import("./pages/DeckDetail"));
const CardList = lazyChunk(() => import("./pages/CardList"));
const CardDetail = lazyChunk(() => import("./pages/CardDetail"));
const RecordGroups = lazyChunk(() => import("./pages/RecordGroups"));
const RecordGroupDetail = lazyChunk(() => import("./pages/RecordGroupDetail"));
const RecordGroupStatistics = lazyChunk(() => import("./pages/RecordGroupStatistics"));
const Tournaments = lazyChunk(() => import("./pages/Tournaments"));
const TournamentHub = lazyChunk(() => import("./pages/TournamentHub"));
const CreateTournament = lazyChunk(() => import("./pages/CreateTournament"));
const TournamentDetailPage = lazyChunk(() => import("./pages/TournamentDetail"));
const DeckScanner = lazyChunk(() => import("./pages/DeckScanner"));
const CardQuiz = lazyChunk(() => import("./pages/CardQuiz"));
const PackList = lazyChunk(() => import("./pages/PackList"));
const PackDetail = lazyChunk(() => import("./pages/PackDetail"));
const Playground = lazyChunk(() => import("./pages/Playground"));
const AllMenu = lazyChunk(() => import("./pages/AllMenu"));
const Tools = lazyChunk(() => import("./pages/Tools"));
const SoloDuchmind = lazyChunk(() => import("./pages/SoloDuchmind"));
const SoloDraw = lazyChunk(() => import("./pages/SoloDraw"));
const SoloDrawingDetail = lazyChunk(() => import("./pages/SoloDrawingDetail"));
const SoloTwenty = lazyChunk(() => import("./pages/SoloTwenty"));
const SkillNames = lazyChunk(() => import("./pages/SkillNames"));
const TierListMaker = lazyChunk(() => import("./pages/TierListMaker"));
const Multiplayer = lazyChunk(() => import("./pages/Multiplayer"));
const MultiplayerRoom = lazyChunk(() => import("./pages/MultiplayerRoom"));
const AdminCardIcons = lazyChunk(() => import("./pages/AdminCardIcons"));
const AdminBorders = lazyChunk(() => import("./pages/AdminBorders"));
const AdminEffectTags = lazyChunk(() => import("./pages/AdminEffectTags"));
const AdminCardGroups = lazyChunk(() => import("./pages/AdminCardGroups"));
const AdminScanLabels = lazyChunk(() => import("./pages/AdminScanLabels"));
const AdminDuchMindWords = lazyChunk(() => import("./pages/AdminDuchMindWords"));
const DuchMindWordPacks = lazyChunk(() => import("./pages/DuchMindWordPacks"));
const DuchMindWordPackDetail = lazyChunk(() => import("./pages/DuchMindWordPackDetail"));
const MyAvatar = lazyChunk(() => import("./pages/MyAvatar"));
const IconShop = lazyChunk(() => import("./pages/IconShop"));
const Changelog = lazyChunk(() => import("./pages/Changelog"));
const InquiryHome = lazyChunk(() => import("./pages/InquiryHome"));
const InquiryBoardPage = lazyChunk(() => import("./pages/InquiryBoardPage"));
const InquiryPostPage = lazyChunk(() => import("./pages/InquiryPostPage"));
const ForgotPassword = lazyChunk(() => import("./pages/ForgotPassword"));
const ResetPassword = lazyChunk(() => import("./pages/ResetPassword"));
const EmailVerified = lazyChunk(() => import("./pages/EmailVerified"));
const Tracker = lazyChunk(() => import("./pages/Tracker"));
const DeckLists = lazyChunk(() => import("./pages/DeckLists"));
const DeckListView = lazyChunk(() => import("./pages/DeckListView"));
const DeckListEdit = lazyChunk(() => import("./pages/DeckListEdit"));

// Shown while a page's code arrives: keeps the footer below the fold, as the page will.
const PAGE_FALLBACK = <div className="min-h-screen" />;

// The book's pages most people open next, fetched once the browser is idle so going there needs no wait.
function prefetchCommonPages() {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  for (const load of [() => import("./pages/Database"), () => import("./pages/DeckDetail"), () => import("./pages/CardList"),
                      () => import("./pages/CardDetail")]) {
    load().catch(() => {});
  }
}

function App() {
  const { pathname } = useLocation();
  useScrollRestoration();
  usePageTracking();
  const inMultiplayerRoom = pathname.startsWith("/multiplayer/rooms/");
  const inDeckEditor = isDeckEditorPath(pathname);
  // The deck database stays mounted (just hidden) while a deck page is open, so Back shows the same list with
  // its pictures already drawn instead of rebuilding it (엘리스 2026-10-02).
  const onDeckList = pathname === "/database";
  const inDeckBook = onDeckList || pathname.startsWith("/database/");
  // Only a list that was already on screen is kept: one first built inside the hidden box makes the browser fetch
  // every thumbnail at once (a deck page opened from Google pulled all 221, 2026-10-06).
  const [listOpened, setListOpened] = useState(onDeckList);
  if (onDeckList && !listOpened) setListOpened(true);
  if (!inDeckBook && listOpened) setListOpened(false);
  const keepDeckList = onDeckList || (listOpened && inDeckBook);
  // The card list is kept the same way behind a card page.
  const onCardList = pathname === "/cards";
  const inCardBook = onCardList || pathname.startsWith("/cards/");
  const [cardListOpened, setCardListOpened] = useState(onCardList);
  if (onCardList && !cardListOpened) setCardListOpened(true);
  if (!inCardBook && cardListOpened) setCardListOpened(false);
  const keepCardList = onCardList || (cardListOpened && inCardBook);
  // While a player is actively drawing (DuchMind turn / Solo draw page),
  // all site chrome is hidden so nothing overlaps the canvas.
  const drawingMode = useDrawingMode();

  // Every move to another page eases the content in, like the tendency test (특이점 2026-10-11). It is an animation
  // on the box around the pages, not a remount, so the kept lists above and every page's state stay as they are;
  // query-only changes (?tab=, filters) don't count as a move.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 2000));
    idle(prefetchCommonPages);
  }, []);

  const pageRef = useRef<HTMLDivElement>(null);
  const firstPage = useRef(true);
  useLayoutEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    pageRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: "ease-out" });
  }, [pathname]);

  return (
    <div>
      {!drawingMode && <TrackerBanner />}
      {!drawingMode && (
        <div className="site-header-bleed">
          <Navbar />
        </div>
      )}
      <NoticePopup disabled={drawingMode || inMultiplayerRoom} />
      <StaffInquiryAlert disabled={drawingMode || inMultiplayerRoom} />
      <TournamentNoticePopup disabled={drawingMode || inMultiplayerRoom} />
      <div ref={pageRef}>
        {keepDeckList && (
          <div hidden={!onDeckList}>
            <Suspense fallback={onDeckList ? PAGE_FALLBACK : null}>
              <DatabasePage />
            </Suspense>
          </div>
        )}
        {keepCardList && (
          <div hidden={!onCardList}>
            <Suspense fallback={onCardList ? PAGE_FALLBACK : null}>
              <CardList />
            </Suspense>
          </div>
        )}
        <Suspense fallback={PAGE_FALLBACK}>
        <Routes>
            <Route path="/" element={<Info />} />
            <Route path="/recommend" element ={<Recommend />} />
            <Route path="/questions" element={<QuestionPage />} />
            <Route path="/result" element={<ResultPage />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/unauthorized" element={<Unauthorized />} />
            {/* The test's answer statistics were retired (2026-10); old links land on the test. */}
            <Route path="/statistics" element={<Navigate to="/recommend" replace />} />
            <Route path="/register" element={<Register />} />
            <Route path="/login" element={<Login />} />
            <Route path="/mypage" element={<Mypage />} />
            <Route path="/mypage/points" element={<PointsHistory />} />
            <Route path="/mypage/notifications" element={<NotificationHistory />} />
            <Route path="/mypage/mydecks" element={<Mydecks />} />
            <Route path="/no-results" element={<Noresults />} />
            <Route path="/database" element={null} />
            <Route path="/database/:deckId" element={<DeckDetail />} />
            <Route path="/cards" element={null} />
            <Route path="/cards/:cardId" element={<CardDetail />} />
            {/* the card book trying one search box for names and 카드군 (operators only, 참혈 2026-10-14) */}
            <Route path="/dev/cards" element={<CardList basePath="/dev/cards" unifiedSearch />} />
            <Route path="/records" element={<RecordGroups />} />
            <Route path="/record-groups/statistics" element={<RecordGroupStatistics />} />
            {/* 대회 (내부 테스트 중 — 네비게이션 미노출) */}
            <Route path="/tournaments" element={<TournamentHub />} />
            <Route path="/tournaments/join" element={<Tournaments />} />
            <Route path="/tournaments/create" element={<CreateTournament />} />
            <Route path="/tournaments/:tournamentId" element={<TournamentDetailPage />} />
            <Route path="/record-groups/:recordGroupId" element={<RecordGroupDetail />} />
            <Route path="/record-groups/:recordGroupId/statistics" element={<RecordGroupStatistics />} />
            <Route path="/deck-scanner" element={<DeckScanner />} />
            <Route path="/card-detector" element={<DeckScanner />} />
            <Route path="/playground" element={<Playground />} />
            <Route path="/all" element={<AllMenu />} />
            <Route path="/tools" element={<Tools />} />
            <Route path="/solo" element={<Navigate to="/playground" replace />} />
            <Route path="/solo-duchmind" element={<SoloDuchmind />} />
            <Route path="/solo-duchmind/draw" element={<SoloDraw />} />
            <Route path="/solo-duchmind/:id" element={<SoloDrawingDetail />} />
            <Route path="/solo-twenty" element={<SoloTwenty />} />
            <Route path="/skill-names" element={<SkillNames />} />
            <Route path="/card-quiz" element={<CardQuiz />} />
            <Route path="/packs" element={<PackList />} />
            <Route path="/packs/collection" element={<Navigate to="/packs" replace />} />
            <Route path="/packs/:packId" element={<PackDetail />} />
            <Route path="/tier-list-maker" element={<TierListMaker />} />
            <Route path="/multiplayer" element={<Multiplayer />} />
            <Route path="/multiplayer/rooms/:roomId" element={<MultiplayerRoom />} />
            <Route path="/manage" element={<AdminIndex />} />
            <Route path="/manage/card-icons" element={<AdminCardIcons />} />
            <Route path="/manage/borders" element={<AdminBorders />} />
            <Route path="/manage/effect-tags" element={<AdminEffectTags />} />
            <Route path="/manage/card-groups" element={<AdminCardGroups />} />
            <Route path="/manage/scan-labels" element={<AdminScanLabels />} />
            <Route path="/manage/duchmind-words" element={<AdminDuchMindWords />} />
            <Route path="/manage/points-grant" element={<AdminPointsGrant />} />
            <Route path="/manage/analytics" element={<AdminAnalytics />} />
            <Route path="/manage/charts" element={<AdminCharts />} />
            <Route path="/duchmind-wordpacks" element={<DuchMindWordPacks />} />
            <Route path="/duchmind-wordpacks/:packId" element={<DuchMindWordPackDetail />} />
            <Route path="/mypage/avatar" element={<MyAvatar />} />
            <Route path="/icon-shop" element={<IconShop />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/email-verified" element={<EmailVerified />} />
            <Route path="/recorder" element={<Tracker />} />
            <Route path="/tracker" element={<Navigate to="/recorder" replace />} />
            <Route path="/changelog" element={<Changelog />} />
            <Route path="/inquiry" element={<InquiryHome />} />
            <Route path="/inquiry/post/:id" element={<InquiryPostPage />} />
            <Route path="/inquiry/:board" element={<InquiryBoardPage />} />
            {/* 덱 구축 (참혈 2026-10-13): operators only while it is laid out, linked from nowhere yet */}
            <Route path="/decklists" element={<DeckLists />} />
            <Route path="/decklists/new" element={<DeckListEdit />} />
            <Route path="/decklists/:code" element={<DeckListView />} />
            <Route path="/decklists/:code/edit" element={<DeckListEdit />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </div>
      {!inMultiplayerRoom && !drawingMode && <Footer />}
      {!drawingMode && <BottomTabBar />}
      <TrackerConfirmModal />
      {!inMultiplayerRoom && !drawingMode && <div className={inDeckEditor ? DECK_EDITOR_ROOM : "sm:hidden h-16"} />}
    </div>
  );
}

export default App;
