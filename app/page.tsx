'use client';

import { useState, useEffect, Fragment, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface AdvertiserAccount {
  customer_id: string;
  ad_account_no: string;
  ad_account_name: string;
  owner_naver_id: string;
  account_role: string;
  last_synced_at: string;
  user_id?: string; // 💡 멀티테넌트 연동 식별값 주입
  is_favorite?: boolean;
  daily_min_cost?: number;
  daily_min_imp?: number;
  daily_min_purchase?: number;
  period_min_cost?: number;
  period_min_imp?: number;
  period_min_purchase?: number;
}

interface CampaignStat {
  campaign_id: string;
  date: string;
  campaign_name: string;
  campaign_type: string;
  campaign_status: string;
  daily_budget: number | null;
  imp_cnt: number;
  clk_cnt: number;
  ctr: number;
  cpc: number;
  sales_amt: number;
  ccnt: number;
  crto: number;
  conv_amt: number;
  ror: number;
  cp_conv: number;
  purchase_ccnt: number;
  purchase_conv_amt: number;
  purchase_ror: number;
}

interface AdGroupStat {
  adgroup_id: string;
  date: string;
  campaign_id: string;
  adgroup_name: string;
  adgroup_type: string;
  adgroup_status: string;
  daily_budget: number | null;
  bid_amt: number | null;
  imp_cnt: number;
  clk_cnt: number;
  ctr: number;
  cpc: number;
  sales_amt: number;
  ccnt: number;
  crto: number;
  conv_amt: number;
  ror: number;
  cp_conv: number;
  purchase_ccnt: number;
  purchase_conv_amt: number;
  purchase_ror: number;
}

interface AdStat {
  ad_id: string;
  date: string;
  campaign_id: string;
  adgroup_id: string;
  ad_name: string;
  ad_type: string;
  ad_status: string;
  inspect_status: string;
  imp_cnt: number;
  clk_cnt: number;
  ctr: number;
  cpc: number;
  sales_amt: number;
  ccnt: number;
  crto: number;
  conv_amt: number;
  ror: number;
  cp_conv: number;
  purchase_ccnt: number;
  purchase_conv_amt: number;
  purchase_ror: number;
}

// 사용자 정보 인터페이스
interface DashboardUser {
  id: string;
  user_name: string;
  login_id: string;
  role: string;
  naver_api_key?: string;
  naver_secret_key?: string;
  naver_customer_id?: string;
  created_at: string;
}

type DatePreset = 'yesterday' | 'last7days' | 'last30days' | 'lastweek' | 'lastmonth' | 'custom';
type SortKey = 'campaign_name' | 'adgroup_name' | 'ad_name' | 'imp_cnt' | 'clk_cnt' | 'ctr' | 'cpc' | 'sales_amt' | 'ccnt' | 'conv_amt' | 'ror';
type SortOrder = 'asc' | 'desc';

export default function Dashboard() {
  const router = useRouter();

  // ⚡ 상태 및 심사 배지 4단계 매핑 헬퍼 함수 정의
  const renderStatusBadge = (status: string) => {
    const s = status ? status.toUpperCase() : 'UNKNOWN';
    switch (s) {
      case 'ELIGIBLE':
        return <span className="badge eligible">노출가능</span>;
      case 'LIMITED_ELIGIBLE':
        return <span className="badge limited_eligible">소진제한(예산)</span>;
      case 'PAUSED':
        return <span className="badge paused">일시중지</span>;
      case 'DELETED':
        return <span className="badge deleted">삭제됨</span>;
      default:
        return <span className="badge paused">{status || '미정'}</span>;
    }
  };

  const renderInspectBadge = (inspectStatus: string) => {
    const s = inspectStatus ? inspectStatus.toUpperCase() : 'UNKNOWN';
    switch (s) {
      case 'APPROVED':
        return <span style={{ fontSize: '0.65rem', color: 'var(--primary-emerald)', fontWeight: 600 }}>승인완료</span>;
      case 'REVIEWING':
        return <span style={{ fontSize: '0.65rem', color: 'var(--primary-amber)', fontWeight: 600 }}>심사대기</span>;
      case 'REJECTED':
        return <span style={{ fontSize: '0.65rem', color: 'var(--primary-rose)', fontWeight: 600 }}>심사반려</span>;
      default:
        return <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{inspectStatus || '대기'}</span>;
    }
  };

  // 비동기 경쟁 상태 (Race Condition) 엇갈림 방지용 참조체
  const activeRequestRef = useRef<number>(0);

  // 1. 사용자 세션 및 권한 관련 상태
  const [currentUser, setCurrentUser] = useState<DashboardUser | null>(null);
  const [loadingUser, setLoadingUser] = useState<boolean>(true);
  const [selectedUserFilter, setSelectedUserFilter] = useState<string>(''); // ADMIN 전용: 특정 유저 필터링
  const [usersList, setUsersList] = useState<DashboardUser[]>([]); // ADMIN 전용: 전체 유저 목록
  const [loadingUsersList, setLoadingUsersList] = useState<boolean>(false);

  // 비밀번호 변경 모달 상태
  const [showPasswordModal, setShowPasswordModal] = useState<boolean>(false);
  const [editProfileName, setEditProfileName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // 사용자 계정 등록/수정 모달 상태 (ADMIN 전용)
  const [showUserModal, setShowUserModal] = useState<boolean>(false);
  const [modalUserTitle, setModalUserTitle] = useState('신규 사용자 등록');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [formUserName, setFormUserName] = useState('');
  const [formLoginId, setFormLoginId] = useState('');
  const [formNaverApiKey, setFormNaverApiKey] = useState('');
  const [formNaverSecretKey, setFormNaverSecretKey] = useState('');
  const [formNaverCustomerId, setFormNaverCustomerId] = useState('');
  const [formRole, setFormRole] = useState('USER');
  const [formPassword, setFormPassword] = useState(''); // 비밀번호 강제 초기화용 (선택)
  const [userModalError, setUserModalError] = useState('');
  const [savingUser, setSavingUser] = useState(false);

  // 2. 기존 대시보드 상태 관리
  const [accounts, setAccounts] = useState<AdvertiserAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [campaigns, setCampaigns] = useState<CampaignStat[]>([]);
  const [adgroups, setAdgroups] = useState<AdGroupStat[]>([]);
  const [ads, setAds] = useState<AdStat[]>([]);
  
  // 마스터 이름 캐시 맵
  const [campaignMasterNames, setCampaignMasterNames] = useState<Map<string, string>>(new Map());
  const [adgroupMasterNames, setAdgroupMasterNames] = useState<Map<string, string>>(new Map());
  
  // 탭 제어 상태 ('briefing' | 'campaign' | 'adgroup' | 'ad' | 'users')
  const [activeTab, setActiveTab] = useState<'briefing' | 'campaign' | 'adgroup' | 'ad' | 'users'>('briefing');
  const [expectedDays, setExpectedDays] = useState<number>(1);
  const [bizmoneyBalance, setBizmoneyBalance] = useState<number | null>(null);
  const [loadingBizmoney, setLoadingBizmoney] = useState<boolean>(false);
  const [anomalyFeed, setAnomalyFeed] = useState<any[]>([]);
  const [popFeed, setPopFeed] = useState<any[]>([]);
  const [selectedAnomaly, setSelectedAnomaly] = useState<any | null>(null);
  
  // 3-tier 아코디언 펼침 ID 세트
  const [expandedCampaignIds, setExpandedCampaignIds] = useState<Set<string>>(new Set());
  const [expandedAdgroupIds, setExpandedAdgroupIds] = useState<Set<string>>(new Set());

  // 날짜 설정 프리셋
  const [datePreset, setDatePreset] = useState<DatePreset>('yesterday');
  
  // 직접 선택(Custom Range) 날짜 상태
  const [customSince, setCustomSince] = useState<string>('');
  const [customUntil, setCustomUntil] = useState<string>('');
  const [appliedCustomSince, setAppliedCustomSince] = useState<string>('');
  const [appliedCustomUntil, setAppliedCustomUntil] = useState<string>('');
  
  // 상태 관리 세분화
  const [loadingAccounts, setLoadingAccounts] = useState<boolean>(true);
  const [loadingCampaigns, setLoadingCampaigns] = useState<boolean>(false);
  const [loadingAdgroups, setLoadingAdgroups] = useState<boolean>(false);
  const [loadingAds, setLoadingAds] = useState<boolean>(false);
  const [syncingAccounts, setSyncingAccounts] = useState<boolean>(false);
  const [syncingCampaigns, setSyncingCampaigns] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<number>(0);
  const [syncStage, setSyncStage] = useState<string>('');
  const [syncMessage, setSyncMessage] = useState<string>('');

  // 지능형 데이터 누락 감지 배너(A안) 관련 상태
  const [dbDistinctDatesCount, setDbDistinctDatesCount] = useState<number>(0);
  const [showDataGapBanner, setShowDataGapBanner] = useState<boolean>(false);
  const [dismissDataGapBanner, setDismissDataGapBanner] = useState<boolean>(false);

  // AI 브리핑 임계값 커스텀 설정 및 % 스캐닝 연산 관련 상태 (V3.13)
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [dailyMinCost, setDailyMinCost] = useState<number>(10000);
  const [dailyMinImp, setDailyMinImp] = useState<number>(500);
  const [dailyMinPurchase, setDailyMinPurchase] = useState<number>(3.0);
  const [periodMinCost, setPeriodMinCost] = useState<number>(30000);
  const [periodMinImp, setPeriodMinImp] = useState<number>(500);
  const [periodMinPurchase, setPeriodMinPurchase] = useState<number>(10.0);
  const [savingSettings, setSavingSettings] = useState<boolean>(false);
  const [updatingBriefingFeed, setUpdatingBriefingFeed] = useState<boolean>(false);
  const [briefingUpdateProgress, setBriefingUpdateProgress] = useState<number>(0);

  // V3.14: ADMIN 통합 포털 3단계용 상태 변수
  const [portalLoading, setPortalLoading] = useState<boolean>(false);
  const [activeAdvertisers, setActiveAdvertisers] = useState<any[]>([]);
  const [megaSummary, setMegaSummary] = useState<any>({
    totalCost: 0,
    totalImp: 0,
    totalClk: 0,
    totalPurchaseCcnt: 0,
    totalPurchaseConvAmt: 0,
    avgCtr: 0,
    avgCpc: 0,
    avgRoas: 0
  });
  const [urgentAlerts, setUrgentAlerts] = useState<any[]>([]);
  
  // V3.16.5: 전체 활성 광고주 수 클릭 시 목록 팝업 모달 상태 추가
  const [showActiveAdvertisersModal, setShowActiveAdvertisersModal] = useState<boolean>(false);
  const [activeSearchTerm, setActiveSearchTerm] = useState<string>('');
  
  // 검색 필터 상태
  const [accountSearchTerm, setAccountSearchTerm] = useState<string>('');
  const [campaignSearchTerm, setCampaignSearchTerm] = useState<string>('');
  const [adgroupSearchTerm, setAdgroupSearchTerm] = useState<string>('');
  const [adSearchTerm, setAdSearchTerm] = useState<string>('');
  
  // 정렬 상태
  const [sortKey, setSortKey] = useState<SortKey>('sales_amt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // KST 기준 프리셋별 날짜 범위 계산
  const getKstDateRange = (preset: DatePreset) => {
    const now = new Date();
    const kstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    
    const formatDate = (d: Date) => {
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const yesterday = new Date(kstNow.getTime() - (24 * 60 * 60 * 1000));
    let sinceDate: Date;
    let untilDate: Date;

    switch (preset) {
      case 'last7days':
        untilDate = yesterday;
        sinceDate = new Date(yesterday.getTime() - (6 * 24 * 60 * 60 * 1000));
        break;
      case 'last30days':
        untilDate = yesterday;
        sinceDate = new Date(yesterday.getTime() - (29 * 24 * 60 * 60 * 1000));
        break;
      case 'lastweek': {
        const currentDay = kstNow.getUTCDay();
        const daysToLastMonday = (currentDay === 0 ? 7 : currentDay) + 6;
        sinceDate = new Date(kstNow.getTime() - (daysToLastMonday * 24 * 60 * 60 * 1000));
        untilDate = new Date(sinceDate.getTime() + (6 * 24 * 60 * 60 * 1000));
        break;
      }
      case 'lastmonth': {
        const year = kstNow.getUTCFullYear();
        const month = kstNow.getUTCMonth();
        sinceDate = new Date(Date.UTC(year, month - 1, 1));
        untilDate = new Date(Date.UTC(year, month, 0));
        break;
      }
      case 'custom':
        return {
          since: appliedCustomSince || customSince || formatDate(yesterday),
          until: appliedCustomUntil || customUntil || formatDate(yesterday)
        };
      case 'yesterday':
      default:
        sinceDate = yesterday;
        untilDate = yesterday;
        break;
    }

    return {
      since: formatDate(sinceDate),
      until: formatDate(untilDate)
    };
  };

  const { since, until } = getKstDateRange(datePreset);

  // A. 로그인 세션 조회
  const fetchCurrentUser = async () => {
    try {
      setLoadingUser(true);
      const response = await fetch('/api/auth/me');
      if (!response.ok) {
        // 인증 실패 시 로그인 페이지로 유도
        router.push('/login');
        return;
      }
      const result = await response.json();
      if (result.success && result.user) {
        setCurrentUser(result.user);
        setSelectedUserFilter(result.user.id); // 초기 필터는 본인 계정 ID로 설정
      } else {
        router.push('/login');
      }
    } catch (err) {
      console.error('Error fetching current user:', err);
      router.push('/login');
    } finally {
      setLoadingUser(false);
    }
  };

  // B. 로그아웃 수행
  const handleLogout = async () => {
    if (!confirm('로그아웃 하시겠습니까?')) return;
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (response.ok) {
        router.push('/login');
      }
    } catch (err) {
      alert('로그아웃 처리 중 오류가 발생했습니다.');
    }
  };

  // C. 개인 정보 및 비밀번호 변경 수행
  const handleChangeProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editProfileName.trim()) {
      setPasswordError('이름을 입력해 주세요.');
      return;
    }

    const hasNewPw = newPassword.length > 0;
    if (hasNewPw) {
      if (newPassword !== confirmPassword) {
        setPasswordError('새 비밀번호와 비밀번호 확인이 일치하지 않습니다.');
        return;
      }
      if (newPassword.length < 4) {
        setPasswordError('새 비밀번호는 최소 4자리 이상이어야 합니다.');
        return;
      }
    }

    try {
      setPasswordError('');
      setPasswordSuccess('');
      setChangingPassword(true);

      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: editProfileName,
          currentPassword,
          newPassword: hasNewPw ? newPassword : ''
        })
      });

      const result = await response.json();
      if (result.success) {
        setPasswordSuccess('개인 정보가 성공적으로 변경되었습니다!');
        if (result.user) {
          setCurrentUser(result.user);
        }
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setTimeout(() => {
          setShowPasswordModal(false);
          setPasswordSuccess('');
        }, 1500);
      } else {
        setPasswordError(result.error || '개인 정보 변경에 실패했습니다.');
      }
    } catch (err) {
      setPasswordError('개인 정보 변경 처리 중 서버 오류가 발생했습니다.');
    } finally {
      setChangingPassword(false);
    }
  };

  // C-2. 비즈머니 잔액 실시간 조회 함수
  const fetchBizmoneyBalance = async (customerId: string) => {
    if (!currentUser || !customerId) return;
    const filterUserId = currentUser.role === 'ADMIN' ? selectedUserFilter : currentUser.id;
    if (!filterUserId) return;

    try {
      setLoadingBizmoney(true);
      let url = `/api/sync/bizmoney?customerId=${customerId}`;
      if (currentUser.role === 'ADMIN' && selectedUserFilter) {
        url += `&targetUserId=${selectedUserFilter}`;
      }

      const response = await fetch(url);
      const result = await response.json();
      if (result.success && result.data) {
        setBizmoneyBalance(result.data.bizmoney);
      } else {
        setBizmoneyBalance(null);
      }
    } catch (err) {
      console.error('Error fetching bizmoney balance:', err);
      setBizmoneyBalance(null);
    } finally {
      setLoadingBizmoney(false);
    }
  };

  // V3.13: 브리핑 임계값 설정 모달 열기 및 값 매핑 핸들러
  const handleOpenSettingsModal = () => {
    if (!activeAccount) return;
    setDailyMinCost(activeAccount.daily_min_cost !== undefined && activeAccount.daily_min_cost !== null ? activeAccount.daily_min_cost : 10000);
    setDailyMinImp(activeAccount.daily_min_imp !== undefined && activeAccount.daily_min_imp !== null ? activeAccount.daily_min_imp : 500);
    setDailyMinPurchase(activeAccount.daily_min_purchase !== undefined && activeAccount.daily_min_purchase !== null ? Number(activeAccount.daily_min_purchase) : 3.0);
    setPeriodMinCost(activeAccount.period_min_cost !== undefined && activeAccount.period_min_cost !== null ? activeAccount.period_min_cost : 30000);
    setPeriodMinImp(activeAccount.period_min_imp !== undefined && activeAccount.period_min_imp !== null ? activeAccount.period_min_imp : 500);
    setPeriodMinPurchase(activeAccount.period_min_purchase !== undefined && activeAccount.period_min_purchase !== null ? Number(activeAccount.period_min_purchase) : 10.0);
    setShowSettingsModal(true);
  };

  // V3.13: 브리핑 임계값 기본값으로 리셋 핸들러
  const handleResetSettings = () => {
    setDailyMinCost(10000);
    setDailyMinImp(500);
    setDailyMinPurchase(3.0);
    setPeriodMinCost(30000);
    setPeriodMinImp(500);
    setPeriodMinPurchase(10.0);
  };

  // V3.13: 브리핑 임계값 Supabase 저장 및 AI 진행률 재연산 연출 핸들러
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccountId) return;
    
    try {
      setSavingSettings(true);
      
      const { error } = await supabase
        .from('advertiser_accounts')
        .update({
          daily_min_cost: dailyMinCost,
          daily_min_imp: dailyMinImp,
          daily_min_purchase: dailyMinPurchase,
          period_min_cost: periodMinCost,
          period_min_imp: periodMinImp,
          period_min_purchase: periodMinPurchase
        })
        .eq('customer_id', selectedAccountId);

      if (error) throw error;

      // Supabase 데이터 최신화
      await fetchAccounts();

      // 모달을 즉시 닫고 AI 스캐닝 연산 오버레이(%) 실행
      setShowSettingsModal(false);
      setUpdatingBriefingFeed(true);
      setBriefingUpdateProgress(0);

      // 0% ~ 100% 진행도 인터벌 연출
      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.floor(Math.random() * 8) + 8; // 8% ~ 15% 씩 랜덤 증가
        if (progress >= 100) {
          progress = 100;
          setBriefingUpdateProgress(100);
          clearInterval(interval);
          
          // 100% 완료 후 약간의 딜레이 뒤 오버레이를 닫고 데이터 재계산
          setTimeout(() => {
            setUpdatingBriefingFeed(false);
            fetchCampaignAndAdGroupStats(selectedAccountId, false);
          }, 600);
        } else {
          setBriefingUpdateProgress(progress);
        }
      }, 150);

    } catch (err: any) {
      alert(`설정 저장 중 오류가 발생했습니다: ${err.message}`);
    } finally {
      setSavingSettings(false);
    }
  };

  // C-3. AI 인사이트 및 Anomaly 연산 엔진
  const runInsightEngine = (
    campRaw: any[],
    adgRaw: any[],
    adRaw: any[],
    expectedSince: string,
    expectedUntil: string,
    popSince?: string,
    popUntil?: string
  ) => {
    if (!campRaw || campRaw.length === 0) {
      setAnomalyFeed([]);
      setPopFeed([]);
      return;
    }

    // 광고주별 커스텀 임계값 바인딩 (V3.13) - 없거나 null이면 기존 기본값 백업 작동
    const minDailyCost = activeAccount?.daily_min_cost !== undefined && activeAccount.daily_min_cost !== null ? activeAccount.daily_min_cost : 10000;
    const minDailyImp = activeAccount?.daily_min_imp !== undefined && activeAccount.daily_min_imp !== null ? activeAccount.daily_min_imp : 500;
    const minDailyPurchase = activeAccount?.daily_min_purchase !== undefined && activeAccount.daily_min_purchase !== null ? Number(activeAccount.daily_min_purchase) : 3.0;
    const minPeriodCost = activeAccount?.period_min_cost !== undefined && activeAccount.period_min_cost !== null ? activeAccount.period_min_cost : 30000;
    const minPeriodImp = activeAccount?.period_min_imp !== undefined && activeAccount.period_min_imp !== null ? activeAccount.period_min_imp : 500;
    const minPeriodPurchase = activeAccount?.period_min_purchase !== undefined && activeAccount.period_min_purchase !== null ? Number(activeAccount.period_min_purchase) : 10.0;

    const newAnomalyFeed: any[] = [];
    const newPopFeed: any[] = [];
    const tempCampaignAnomalies: any[] = [];

    // --- A. 최근 1일 증분 이상 분석 (Latest Daily Increment Anomaly) ---
    const currentPeriodCamps = campRaw.filter(r => r.date >= expectedSince && r.date <= expectedUntil);
    const sortedDates = Array.from(new Set(currentPeriodCamps.map(r => r.date))).sort();

    if (sortedDates.length >= 2) {
      const latestDate = sortedDates[sortedDates.length - 1];
      const priorDates = sortedDates.slice(0, sortedDates.length - 1);
      const priorDaysCount = priorDates.length;

      const campLatest = currentPeriodCamps.filter(r => r.date === latestDate);
      const campPrior = currentPeriodCamps.filter(r => r.date !== latestDate);

      const campPriorSum: { [key: string]: { imp: number; clk: number; cost: number; purchaseCcnt: number; purchaseConvAmt: number } } = {};
      campPrior.forEach(row => {
        const cid = row.campaign_id;
        if (!campPriorSum[cid]) campPriorSum[cid] = { imp: 0, clk: 0, cost: 0, purchaseCcnt: 0, purchaseConvAmt: 0 };
        campPriorSum[cid].imp += row.imp_cnt || 0;
        campPriorSum[cid].clk += row.clk_cnt || 0;
        campPriorSum[cid].cost += row.sales_amt || 0;
        campPriorSum[cid].purchaseCcnt += row.purchase_ccnt || 0;
        campPriorSum[cid].purchaseConvAmt += row.purchase_conv_amt || 0;
      });

      campLatest.forEach(row => {
        const cid = row.campaign_id;
        const prior = campPriorSum[cid];
        if (!prior) return;

        const avgImp = prior.imp / priorDaysCount;
        const avgClk = prior.clk / priorDaysCount;
        const avgCost = prior.cost / priorDaysCount;
        const avgPurchaseCcnt = prior.purchaseCcnt / priorDaysCount;
        const avgCtr = avgImp > 0 ? (avgClk / avgImp) * 100 : 0;
        const avgCrto = avgClk > 0 ? (prior.purchaseCcnt / prior.clk) * 100 : 0;
        const avgRoas = prior.cost > 0 ? (prior.purchaseConvAmt / prior.cost) * 100 : 0;

        const curImp = row.imp_cnt || 0;
        const curClk = row.clk_cnt || 0;
        const curCost = row.sales_amt || 0;
        const curPurchaseCcnt = row.purchase_ccnt || 0;
        const curCtr = curImp > 0 ? (curClk / curImp) * 100 : 0;
        const curCrto = curClk > 0 ? (curPurchaseCcnt / curClk) * 100 : 0;
        const curRoas = curCost > 0 ? (row.purchase_conv_amt / curCost) * 100 : 0;

        const details = [
          { metric: '노출수', prev: Math.round(avgImp), current: Math.round(curImp), unit: '회' },
          { metric: '클릭수', prev: Math.round(avgClk), current: Math.round(curClk), unit: '회' },
          { metric: '광고비', prev: Math.round(avgCost), current: Math.round(curCost), unit: '원' },
          { metric: '구매완료수', prev: Math.round(avgPurchaseCcnt), current: Math.round(curPurchaseCcnt), unit: '건' },
          { metric: '클릭률(CTR)', prev: Math.round(avgCtr * 100) / 100, current: Math.round(curCtr * 100) / 100, unit: '%' },
          { metric: '구매전환율(CRTO)', prev: Math.round(avgCrto * 100) / 100, current: Math.round(curCrto * 100) / 100, unit: '%' },
          { metric: '광고수익률(ROAS)', prev: Math.round(avgRoas), current: Math.round(curRoas), unit: '%' }
        ];

        // 1. 광고비 변동 감지
        if (avgCost >= minDailyCost) {
          const costRatio = curCost / avgCost;
          if (costRatio >= 2.0) {
            tempCampaignAnomalies.push({
              campaignId: cid,
              type: 'SURGE_COST',
              level: 'CAMPAIGN',
              name: row.campaign_name,
              message: `캠페인 일 광고비가 평소(일 평균 ${formatNumber(Math.round(avgCost))}원) 대비 **${((costRatio - 1) * 100).toFixed(0)}% 폭증**한 **${formatNumber(Math.round(curCost))}원** 소진되어 예산 과소진 징후를 감지했습니다.`,
              ratio: costRatio,
              details,
              periodInfo: `이전 일 평균 대비 ${latestDate} 하루 성과`
            });
          } else if (curCost <= avgCost * 0.15 && row.campaign_status === 'ELIGIBLE') {
            tempCampaignAnomalies.push({
              campaignId: cid,
              type: 'DROP_COST',
              level: 'CAMPAIGN',
              name: row.campaign_name,
              message: `캠페인 일 광고비가 평소(일 평균 ${formatNumber(Math.round(avgCost))}원) 대비 **${((1 - costRatio) * 100).toFixed(0)}% 급감**한 **${formatNumber(Math.round(curCost))}원** 소진에 그쳤습니다. (ON 상태이나 소진 멈춤 감지)`,
              ratio: costRatio,
              details,
              periodInfo: `이전 일 평균 대비 ${latestDate} 하루 성과`
            });
          }
        }

        // 2. 트래픽(노출수) 변동 감지
        if (avgImp >= minDailyImp) {
          const impRatio = curImp / avgImp;
          if (impRatio >= 2.5) {
            tempCampaignAnomalies.push({
              campaignId: cid,
              type: 'SPIKE_TRAFFIC',
              level: 'CAMPAIGN',
              name: row.campaign_name,
              message: `캠페인 하루 노출수가 평소(일 평균 ${formatNumber(Math.round(avgImp))}회) 대비 **${((impRatio - 1) * 100).toFixed(0)}% 폭증**한 **${formatNumber(curImp)}회**를 기록했습니다!`,
              ratio: impRatio,
              details,
              periodInfo: `이전 일 평균 대비 ${latestDate} 하루 성과`
            });
          }
        }

        // 3. 구매 전환수 급증/급감 감지
        if (avgPurchaseCcnt >= minDailyPurchase) {
          const purchaseRatio = curPurchaseCcnt / avgPurchaseCcnt;
          if (purchaseRatio >= 2.0) {
            tempCampaignAnomalies.push({
              campaignId: cid,
              type: 'SURGE_PURCHASE',
              level: 'CAMPAIGN',
              name: row.campaign_name,
              message: `캠페인 일 구매완료 수가 평소(일 평균 ${avgPurchaseCcnt.toFixed(1)}건) 대비 **${((purchaseRatio - 1) * 100).toFixed(0)}% 폭증**한 **${curPurchaseCcnt}건**을 기록하며 폭발적인 효율을 기록했습니다!`,
              ratio: purchaseRatio,
              details,
              periodInfo: `이전 일 평균 대비 ${latestDate} 하루 성과`
            });
          } else if (purchaseRatio <= 0.2) {
            tempCampaignAnomalies.push({
              campaignId: cid,
              type: 'DROP_PURCHASE',
              level: 'CAMPAIGN',
              name: row.campaign_name,
              message: `캠페인 일 구매완료 수가 평소(일 평균 ${avgPurchaseCcnt.toFixed(1)}건) 대비 **${((1 - purchaseRatio) * 100).toFixed(0)}% 급감**한 **${curPurchaseCcnt}건**에 그쳤습니다. 상세 설정이나 상세 페이지 품절 여부를 체크하세요!`,
              ratio: purchaseRatio,
              details,
              periodInfo: `이전 일 평균 대비 ${latestDate} 하루 성과`
            });
          }
        } else if (avgPurchaseCcnt >= minDailyPurchase && curPurchaseCcnt === 0 && priorDaysCount >= 3) {
          tempCampaignAnomalies.push({
            campaignId: cid,
            type: 'ZERO_PURCHASE',
            level: 'CAMPAIGN',
            name: row.campaign_name,
            message: `평소 꾸준히 구매 전환이 일어나던 캠페인이나, 오늘 하루 **구매 완료가 0건**에 그쳤습니다. 전환 링크 작동 여부를 점검해 보세요.`,
            ratio: 0,
            details,
            periodInfo: `이전 일 평균 대비 ${latestDate} 하루 성과`
          });
        }

        // 4. 광고수익률(ROAS) 급증/급감 감지
        if (avgRoas > 10 && avgCost >= minDailyCost && avgImp >= minDailyImp && avgClk >= 10) {
          const roasRatio = curRoas / avgRoas;
          if (roasRatio >= 1.5) {
            tempCampaignAnomalies.push({
              campaignId: cid,
              type: 'SURGE_ROAS',
              level: 'CAMPAIGN',
              name: row.campaign_name,
              message: `캠페인 하루 구매 ROAS가 평소(일 평균 ${avgRoas.toFixed(0)}%) 대비 **${((roasRatio - 1) * 100).toFixed(0)}% 급상승**한 **${curRoas.toFixed(0)}%**를 달성하여 광고 효율이 극대화되었습니다!`,
              ratio: roasRatio,
              details,
              periodInfo: `이전 일 평균 대비 ${latestDate} 하루 성과`
            });
          } else if (roasRatio <= 0.3) {
            tempCampaignAnomalies.push({
              campaignId: cid,
              type: 'DROP_ROAS',
              level: 'CAMPAIGN',
              name: row.campaign_name,
              message: `캠페인 하루 구매 ROAS가 평소(일 평균 ${avgRoas.toFixed(0)}%) 대비 **${((1 - roasRatio) * 100).toFixed(0)}% 폭락**한 **${curRoas.toFixed(0)}%**에 그쳐 효율 저하 징후를 감지했습니다. 소재 교체 타이밍인지 확인해 보세요.`,
              ratio: roasRatio,
              details,
              periodInfo: `이전 일 평균 대비 ${latestDate} 하루 성과`
            });
          }
        }

        // 5. 클릭률(CTR) 급증/급감 감지 (추가)
        if (avgCtr > 0.1 && avgImp >= minDailyImp && avgClk >= 30) {
          const ctrRatio = curCtr / avgCtr;
          if (ctrRatio >= 1.8) {
            tempCampaignAnomalies.push({
              campaignId: cid,
              type: 'SURGE_CTR',
              level: 'CAMPAIGN',
              name: row.campaign_name,
              message: `캠페인 하루 클릭률(CTR)이 평소(일 평균 ${avgCtr.toFixed(2)}%) 대비 **${((ctrRatio - 1) * 100).toFixed(0)}% 급상승**한 **${curCtr.toFixed(2)}%**를 달성하여 유입 효율이 극대화되었습니다!`,
              ratio: ctrRatio,
              details,
              periodInfo: `이전 일 평균 대비 ${latestDate} 하루 성과`
            });
          } else if (ctrRatio <= 0.4) {
            tempCampaignAnomalies.push({
              campaignId: cid,
              type: 'DROP_CTR',
              level: 'CAMPAIGN',
              name: row.campaign_name,
              message: `캠페인 하루 클릭률(CTR)이 평소(일 평균 ${avgCtr.toFixed(2)}%) 대비 **${((1 - ctrRatio) * 100).toFixed(0)}% 급락**한 **${curCtr.toFixed(2)}%**에 그쳐 소재 매력도가 떨어진 징후를 감지했습니다. 소재 교체 타이밍을 검토해 보세요.`,
              ratio: ctrRatio,
              details,
              periodInfo: `이전 일 평균 대비 ${latestDate} 하루 성과`
            });
          }
        }

        // 6. 구매 전환율(CRTO) 급증/급감 감지 (추가)
        if (avgCrto > 0.1 && avgClk >= 100 && avgPurchaseCcnt >= 5) {
          const crtoRatio = curCrto / avgCrto;
          if (crtoRatio >= 2.0) {
            tempCampaignAnomalies.push({
              campaignId: cid,
              type: 'SURGE_CRTO',
              level: 'CAMPAIGN',
              name: row.campaign_name,
              message: `캠페인 하루 구매 전환율(CRTO)이 평소(일 평균 ${avgCrto.toFixed(2)}%) 대비 **${((crtoRatio - 1) * 100).toFixed(0)}% 폭증**한 **${curCrto.toFixed(2)}%**를 달성하며 폭발적인 구매력을 보였습니다!`,
              ratio: crtoRatio,
              details,
              periodInfo: `이전 일 평균 대비 ${latestDate} 하루 성과`
            });
          } else if (crtoRatio <= 0.2) {
            tempCampaignAnomalies.push({
              campaignId: cid,
              type: 'DROP_CRTO',
              level: 'CAMPAIGN',
              name: row.campaign_name,
              message: `캠페인 하루 구매 전환율(CRTO)이 평소(일 평균 ${avgCrto.toFixed(2)}%) 대비 **${((1 - crtoRatio) * 100).toFixed(0)}% 급락**한 **${curCrto.toFixed(2)}%**에 그쳤습니다. 상세 페이지나 결제 오류가 없는지 점검하세요.`,
              ratio: crtoRatio,
              details,
              periodInfo: `이전 일 평균 대비 ${latestDate} 하루 성과`
            });
          }
        }
      });

      // 캠페인별 Anomaly 중복 제거 및 우선순위 필터링 적용
      const anomalyPriority: { [key: string]: number } = {
        'ZERO_PURCHASE': 1,
        'DROP_PURCHASE': 2,
        'DROP_COST': 3,
        'DROP_ROAS': 4,
        'DROP_CTR': 5,
        'DROP_CRTO': 6,
        'SURGE_COST': 7,
        'SURGE_PURCHASE': 8,
        'SURGE_ROAS': 9,
        'SURGE_CTR': 10,
        'SURGE_CRTO': 11,
        'SPIKE_TRAFFIC': 12
      };

      const groupedByCamp: { [key: string]: any[] } = {};
      tempCampaignAnomalies.forEach(item => {
        const key = item.campaignId;
        if (!groupedByCamp[key]) groupedByCamp[key] = [];
        groupedByCamp[key].push(item);
      });

      Object.keys(groupedByCamp).forEach(key => {
        const list = groupedByCamp[key];
        list.sort((a, b) => {
          const scoreA = anomalyPriority[a.type] || 99;
          const scoreB = anomalyPriority[b.type] || 99;
          return scoreA - scoreB;
        });
        newAnomalyFeed.push(list[0]);
      });


      // 광고그룹 Anomaly 감지
      const currentPeriodAdgs = adgRaw.filter(r => r.date >= expectedSince && r.date <= expectedUntil);
      const adgLatest = currentPeriodAdgs.filter(r => r.date === latestDate);
      const adgPrior = currentPeriodAdgs.filter(r => r.date !== latestDate);

      const adgPriorSum: { [key: string]: { imp: number; clk: number; cost: number } } = {};
      adgPrior.forEach(row => {
         const gid = row.adgroup_id;
         if (!adgPriorSum[gid]) adgPriorSum[gid] = { imp: 0, clk: 0, cost: 0 };
         adgPriorSum[gid].imp += row.imp_cnt || 0;
         adgPriorSum[gid].clk += row.clk_cnt || 0;
         adgPriorSum[gid].cost += row.sales_amt || 0;
      });

      adgLatest.forEach(row => {
         const gid = row.adgroup_id;
         const prior = adgPriorSum[gid];
         if (!prior) return;

         const avgAdgCost = prior.cost / priorDaysCount;
         const avgAdgImp = prior.imp / priorDaysCount;
         const avgAdgClk = prior.clk / priorDaysCount;
         const curAdgCost = row.sales_amt || 0;
         const curAdgImp = row.imp_cnt || 0;
         const curAdgClk = row.clk_cnt || 0;
         const avgAdgCtr = avgAdgImp > 0 ? (avgAdgClk / avgAdgImp) * 100 : 0;
         const curAdgCtr = curAdgImp > 0 ? (curAdgClk / curAdgImp) * 100 : 0;

         const adgDetails = [
           { metric: '노출수', prev: Math.round(avgAdgImp), current: Math.round(curAdgImp), unit: '회' },
           { metric: '클릭수', prev: Math.round(avgAdgClk), current: Math.round(curAdgClk), unit: '회' },
           { metric: '광고비', prev: Math.round(avgAdgCost), current: Math.round(curAdgCost), unit: '원' },
           { metric: '클릭률(CTR)', prev: Math.round(avgAdgCtr * 100) / 100, current: Math.round(curAdgCtr * 100) / 100, unit: '%' }
         ];

         if (avgAdgCost >= minDailyCost && curAdgCost <= avgAdgCost * 0.05 && row.adgroup_status === 'ELIGIBLE') {
          newAnomalyFeed.push({
            type: 'DROP_COST_ADGROUP',
            level: 'ADGROUP',
            name: row.adgroup_name,
            message: `광고그룹 일 소진액이 평소 일 평균(${formatNumber(Math.round(avgAdgCost))}원) 대비 **95% 이상 급감**한 **${formatNumber(Math.round(curAdgCost))}원** 소진되었습니다. 광고 세팅 노출제한 여부나 링크 품절을 긴급 체크하세요!`,
            ratio: curAdgCost / avgAdgCost,
            details: adgDetails,
            periodInfo: `이전 일 평균 대비 ${latestDate} 하루 성과`
          });
        }
      });
    }

    // --- B. 직전 기간 대비 변동(Period over Period) 분석 피드 ---
    if (popSince && popUntil) {
      const currentPeriodCamps = campRaw.filter(r => r.date >= expectedSince && r.date <= expectedUntil);
      const priorPeriodCamps = campRaw.filter(r => r.date >= popSince && r.date <= popUntil);
      const tempCampaignPops: any[] = [];

      const currentAgg: { [key: string]: { imp: number; clk: number; cost: number; purchaseCcnt: number; purchaseConvAmt: number; name: string } } = {};
      currentPeriodCamps.forEach(row => {
        const cid = row.campaign_id;
        if (!currentAgg[cid]) currentAgg[cid] = { imp: 0, clk: 0, cost: 0, purchaseCcnt: 0, purchaseConvAmt: 0, name: row.campaign_name };
        currentAgg[cid].imp += row.imp_cnt || 0;
        currentAgg[cid].clk += row.clk_cnt || 0;
        currentAgg[cid].cost += row.sales_amt || 0;
        currentAgg[cid].purchaseCcnt += row.purchase_ccnt || 0;
        currentAgg[cid].purchaseConvAmt += row.purchase_conv_amt || 0;
      });

      const priorAgg: { [key: string]: { imp: number; clk: number; cost: number; purchaseCcnt: number; purchaseConvAmt: number; name: string } } = {};
      priorPeriodCamps.forEach(row => {
        const cid = row.campaign_id;
        if (!priorAgg[cid]) priorAgg[cid] = { imp: 0, clk: 0, cost: 0, purchaseCcnt: 0, purchaseConvAmt: 0, name: row.campaign_name };
        priorAgg[cid].imp += row.imp_cnt || 0;
        priorAgg[cid].clk += row.clk_cnt || 0;
        priorAgg[cid].cost += row.sales_amt || 0;
        priorAgg[cid].purchaseCcnt += row.purchase_ccnt || 0;
        priorAgg[cid].purchaseConvAmt += row.purchase_conv_amt || 0;
      });

      Object.keys(currentAgg).forEach(cid => {
        const cur = currentAgg[cid];
        const prev = priorAgg[cid];
        if (!prev) return;

        const prevImp = prev.imp;
        const curImp = cur.imp;
        const prevClk = prev.clk;
        const curClk = cur.clk;
        const prevCost = prev.cost;
        const curCost = cur.cost;
        const prevPurchaseCcnt = prev.purchaseCcnt;
        const curPurchaseCcnt = cur.purchaseCcnt;

        const prevCtr = prevImp > 0 ? (prevClk / prevImp) * 100 : 0;
        const curCtr = curImp > 0 ? (curClk / curImp) * 100 : 0;
        const prevCrto = prevClk > 0 ? (prev.purchaseCcnt / prevClk) * 100 : 0;
        const curCrto = curClk > 0 ? (cur.purchaseCcnt / curClk) * 100 : 0;
        const prevRoas = prevCost > 0 ? (prev.purchaseConvAmt / prevCost) * 100 : 0;
        const curRoas = curCost > 0 ? (cur.purchaseConvAmt / curCost) * 100 : 0;

        const details = [
          { metric: '노출수', prev: Math.round(prevImp), current: Math.round(curImp), unit: '회' },
          { metric: '클릭수', prev: Math.round(prevClk), current: Math.round(curClk), unit: '회' },
          { metric: '광고비', prev: Math.round(prevCost), current: Math.round(curCost), unit: '원' },
          { metric: '구매완료수', prev: Math.round(prevPurchaseCcnt), current: Math.round(curPurchaseCcnt), unit: '건' },
          { metric: '클릭률(CTR)', prev: Math.round(prevCtr * 100) / 100, current: Math.round(curCtr * 100) / 100, unit: '%' },
          { metric: '구매전환율(CRTO)', prev: Math.round(prevCrto * 100) / 100, current: Math.round(curCrto * 100) / 100, unit: '%' },
          { metric: '광고수익률(ROAS)', prev: Math.round(prevRoas), current: Math.round(curRoas), unit: '%' }
        ];

        // 1. 노출수 변동 비율 감지
        if (prevImp >= minPeriodImp) {
          const changeRatio = (curImp - prevImp) / prevImp;
          if (Math.abs(changeRatio) >= 0.25) {
            tempCampaignPops.push({
              campaignId: cid,
              type: changeRatio > 0 ? 'TRAFFIC_GROWTH' : 'TRAFFIC_DECLINE',
              name: cur.name,
              message: changeRatio > 0 
                ? `이전 동등 기간 대비 노출 트래픽이 **${(changeRatio * 100).toFixed(0)}% 급상승**한 **${formatNumber(Math.round(curImp))}회**를 기록하며 활성화 중입니다!`
                : `이전 동등 기간 대비 노출 트래픽이 **${(Math.abs(changeRatio) * 100).toFixed(0)}% 급락**한 **${formatNumber(Math.round(curImp))}회**에 그쳐 침체 구간에 진입했습니다.`,
              ratio: changeRatio,
              details,
              periodInfo: `이전 동등 기간(${popSince} ~ ${popUntil}) 대비 이번 기간(${expectedSince} ~ ${expectedUntil})`
            });
          }
        }

        // 2. 광고비 변동 비율 감지
        if (prevCost >= minPeriodCost) {
          const changeRatio = (curCost - prevCost) / prevCost;
          if (Math.abs(changeRatio) >= 0.3) {
            tempCampaignPops.push({
              campaignId: cid,
              type: changeRatio > 0 ? 'COST_GROWTH' : 'COST_DECLINE',
              name: cur.name,
              message: changeRatio > 0
                ? `이전 동등 기간 대비 소진 광고비가 **${(changeRatio * 100).toFixed(0)}% 급증**한 **${formatNumber(Math.round(curCost))}원**에 달해 예산 소진 속도가 과도하게 빨라졌습니다.`
                : `이전 동등 기간 대비 소진 광고비가 **${(Math.abs(changeRatio) * 100).toFixed(0)}% 급감**한 **${formatNumber(Math.round(curCost))}원**에 그쳤습니다.`,
              ratio: changeRatio,
              details,
              periodInfo: `이전 동등 기간(${popSince} ~ ${popUntil}) 대비 이번 기간(${expectedSince} ~ ${expectedUntil})`
            });
          }
        }

        // 3. 구매완료수 변동 감지
        if (prevPurchaseCcnt >= minPeriodPurchase) {
          const changeRatio = (curPurchaseCcnt - prevPurchaseCcnt) / prevPurchaseCcnt;
          if (Math.abs(changeRatio) >= 0.3) {
            tempCampaignPops.push({
              campaignId: cid,
              type: changeRatio > 0 ? 'PURCHASE_GROWTH' : 'PURCHASE_DECLINE',
              name: cur.name,
              message: changeRatio > 0
                ? `이전 동등 기간 대비 구매완료 수가 **${(changeRatio * 100).toFixed(0)}% 폭증**한 **${curPurchaseCcnt}건**을 기록하며 폭발적인 광고 효율을 내고 있습니다!`
                : `이전 동등 기간 대비 구매완료 수가 **${(Math.abs(changeRatio) * 100).toFixed(0)}% 급감**한 **${curPurchaseCcnt}건**에 그쳤습니다. 소재 교체나 타겟 조정을 검토하세요.`,
              ratio: changeRatio,
              details,
              periodInfo: `이전 동등 기간(${popSince} ~ ${popUntil}) 대비 이번 기간(${expectedSince} ~ ${expectedUntil})`
            });
          }
        }
      });

      // 캠페인별 PoP 변동 중복 제거 및 우선순위 필터링 적용
      const popPriority: { [key: string]: number } = {
        'PURCHASE_DECLINE': 1,
        'PURCHASE_GROWTH': 2,
        'COST_GROWTH': 3,
        'COST_DECLINE': 4,
        'TRAFFIC_DECLINE': 5,
        'TRAFFIC_GROWTH': 6
      };

      const groupedByCampPop: { [key: string]: any[] } = {};
      tempCampaignPops.forEach(item => {
        const key = item.campaignId;
        if (!groupedByCampPop[key]) groupedByCampPop[key] = [];
        groupedByCampPop[key].push(item);
      });

      Object.keys(groupedByCampPop).forEach(key => {
        const list = groupedByCampPop[key];
        list.sort((a, b) => {
          const scoreA = popPriority[a.type] || 99;
          const scoreB = popPriority[b.type] || 99;
          return scoreA - scoreB;
        });
        newPopFeed.push(list[0]);
      });
    }

    setAnomalyFeed(newAnomalyFeed.slice(0, 8));
    setPopFeed(newPopFeed.slice(0, 8));
  };

  // D. (ADMIN 전용) 신규/기존 유저 목록 조회
  const fetchUsersList = async () => {
    if (currentUser?.role !== 'ADMIN') return;
    try {
      setLoadingUsersList(true);
      const response = await fetch('/api/admin/users');
      const result = await response.json();
      if (result.success) {
        setUsersList(result.users || []);
      }
    } catch (err: any) {
      console.error('Error loading users list:', err.message);
    } finally {
      setLoadingUsersList(false);
    }
  };

  // E. (ADMIN 전용) 신규 사용자 생성 또는 수정
  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formUserName.trim() || !formLoginId.trim() || !formNaverApiKey.trim() || !formNaverSecretKey.trim() || !formNaverCustomerId.trim()) {
      setUserModalError('모든 필수 입력 값을 기입해 주세요.');
      return;
    }

    try {
      setUserModalError('');
      setSavingUser(true);

      const isEdit = !!editingUserId;
      const url = isEdit ? `/api/admin/users/${editingUserId}` : '/api/admin/users';
      const method = isEdit ? 'PUT' : 'POST';

      const payload: any = {
        userName: formUserName,
        loginId: formLoginId,
        naverApiKey: formNaverApiKey,
        naverSecretKey: formNaverSecretKey,
        naverCustomerId: formNaverCustomerId,
        role: formRole
      };

      if (isEdit && formPassword.trim().length > 0) {
        payload.password = formPassword; // 비밀번호 강제 초기화
      }

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (result.success) {
        alert(result.message);
        setShowUserModal(false);
        fetchUsersList();
      } else {
        setUserModalError(result.error || '사용자 저장에 실패했습니다.');
      }
    } catch (err: any) {
      setUserModalError('저장 중 서버 통신 에러가 발생했습니다.');
    } finally {
      setSavingUser(false);
    }
  };

  // F. (ADMIN 전용) 사용자 삭제
  const handleDeleteUser = async (user: DashboardUser) => {
    if (!confirm(`사용자 '${user.user_name}' 님을 정말 삭제하시겠습니까?\n해당 사용자와 관련된 누적 연동 광고 데이터가 모두 함께 영구 파기됩니다.`)) return;
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      const result = await response.json();
      if (result.success) {
        alert(result.message);
        fetchUsersList();
      } else {
        alert(result.error || '사용자 삭제 실패');
      }
    } catch (err) {
      alert('삭제 중 서버 에러가 발생했습니다.');
    }
  };

  // G. (ADMIN 전용) 신규 등록 모달 열기
  const openAddUserModal = () => {
    setModalUserTitle('신규 사용자 등록');
    setEditingUserId(null);
    setFormUserName('');
    setFormLoginId('');
    setFormNaverApiKey('');
    setFormNaverSecretKey('');
    setFormNaverCustomerId('');
    setFormRole('USER');
    setFormPassword('');
    setUserModalError('');
    setShowUserModal(true);
  };

  // H. (ADMIN 전용) 사용자 정보 수정 모달 열기
  const openEditUserModal = (user: DashboardUser) => {
    setModalUserTitle(`'${user.user_name}' 정보 수정`);
    setEditingUserId(user.id);
    setFormUserName(user.user_name);
    setFormLoginId(user.login_id);
    setFormNaverApiKey(user.naver_api_key || '');
    setFormNaverSecretKey(user.naver_secret_key || '');
    setFormNaverCustomerId(user.naver_customer_id || '');
    setFormRole(user.role);
    setFormPassword(''); // 기본은 비워둠 (입력 시에만 변경)
    setUserModalError('');
    setShowUserModal(true);
  };

  // 1. 광고주 계정 목록 조회 (Supabase - 격리 필터 적용)
  const fetchAccounts = async () => {
    if (!currentUser) return;
    try {
      setLoadingAccounts(true);
      
      let query = supabase
        .from('advertiser_accounts')
        .select('*');
      
      // 멀티테넌트 권한에 따른 조회 격리
      const filterUserId = currentUser.role === 'ADMIN' ? selectedUserFilter : currentUser.id;
      if (filterUserId) {
        query = query.eq('user_id', filterUserId);
      } else {
        // 필터 아이디가 없는 상태면 빈 리스트 반환
        setAccounts([]);
        setLoadingAccounts(false);
        return;
      }

      const { data, error } = await query.order('ad_account_name', { ascending: true });

      if (error) throw error;
      setAccounts(data || []);
    } catch (err: any) {
      console.error('Error fetching accounts:', err.message);
    } finally {
      setLoadingAccounts(false);
    }
  };

  // V3.16.2: ADMIN 및 일반 USER 겸용 통합 마케팅 성과 포털 데이터 수집 및 고속 판정 함수
  const fetchPortalData = async () => {
    if (accounts.length === 0) {
      console.log('⚠️ [DEBUG PORTAL] accounts가 0개이므로 포털 연산을 건너뜁니다.');
      setActiveAdvertisers([]);
      setUrgentAlerts([]);
      return;
    }

    try {
      setPortalLoading(true);
      
      // ⚡ V3.16.0: 역할(ADMIN vs USER)에 따른 관제 타겟 광고주 격리 및 즐겨찾기 필터 적용
      let targetAccounts = [];
      
      if (currentUser?.role === 'ADMIN') {
        const myAccounts = accounts.filter(a => a.user_id === currentUser?.id);
        targetAccounts = myAccounts.length > 0 ? myAccounts : accounts;
      } else {
        // 일반 유저(USER)인 경우: 본인 소유 계정 중 즐겨찾기(is_favorite === true)가 되어 있는 계정만 최대 3개 매핑
        const favoriteAccounts = accounts.filter(a => a.is_favorite === true);
        targetAccounts = favoriteAccounts.slice(0, 3);
      }

      if (targetAccounts.length === 0) {
        console.log('⚠️ [DEBUG PORTAL] targetAccounts가 0개이므로 포털 연산을 건너뜁니다.');
        setActiveAdvertisers([]);
        setUrgentAlerts([]);
        setPortalLoading(false);
        return;
      }

      const customerIds = targetAccounts.map(a => a.customer_id);
      
      const now = new Date();
      const kstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
      const yesterday = new Date(kstNow.getTime() - (24 * 60 * 60 * 1000));
      const formatDate = (d: Date) => {
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      
      const yesterdayStr = formatDate(yesterday);
      const since30Days = new Date(yesterday.getTime() - (29 * 24 * 60 * 60 * 1000));
      const since30DaysStr = formatDate(since30Days);

      // 🔍 [정밀 디버깅 로그 작동]
      console.log('=== 🔍 [DEBUG PORTAL START] ===');
      console.log('1. 현재 로그인 유저 (currentUser):', currentUser);
      console.log('2. 사이드바 전체 광고주 수 (accounts):', accounts.length);
      console.log('3. 최종 분석 타겟 광고주 수 (targetAccounts):', targetAccounts.length);
      console.log('4. 분석 대상 customer_id 리스트:', customerIds);
      console.log('5. 어제 기준 판정 날짜 (yesterdayStr):', yesterdayStr);
      console.log('6. 30일 범위 시작 날짜 (since30DaysStr):', since30DaysStr);

      // ⚡ V3.16.2: 어제 하루치(yesterdayStr) 세부 지표(노출, 클릭, 구매수, 매출액)는 용량이 매우 작으므로(최대 500행 미만), 
      // 1,000건 제한에 절대 막히지 않는 초고속 Direct Query로 가져와서 RPC 30일 소진비 결과와 결합(Join)합니다!
      let yesterdayDetails: any[] = [];
      try {
        const { data: yData, error: yErr } = await supabase
          .from('campaign_stats')
          .select('customer_id, imp_cnt, clk_cnt, purchase_ccnt, purchase_conv_amt')
          .eq('date', yesterdayStr)
          .in('customer_id', customerIds);
          
        if (yErr) throw yErr;
        yesterdayDetails = yData || [];
        console.log(`7. DB에서 성공적으로 가져온 어제 세부 성과 행 개수: ${yesterdayDetails.length}건`);
      } catch (err) {
        console.error('⚠️ [DEBUG PORTAL] 어제 세부 데이터 로드 실패:', err);
      }

      // customer_id별 어제 세부 지표 합산 맵 구성
      const yesterdayDetailMap: { [key: string]: { imp: number, clk: number, purchase: number, sales: number } } = {};
      customerIds.forEach(cid => {
        yesterdayDetailMap[cid] = { imp: 0, clk: 0, purchase: 0, sales: 0 };
      });
      
      yesterdayDetails.forEach(item => {
        if (yesterdayDetailMap[item.customer_id]) {
          yesterdayDetailMap[item.customer_id].imp += (item.imp_cnt || 0);
          yesterdayDetailMap[item.customer_id].clk += (item.clk_cnt || 0);
          yesterdayDetailMap[item.customer_id].purchase += (item.purchase_ccnt || 0);
          yesterdayDetailMap[item.customer_id].sales += (item.purchase_conv_amt || 0);
        }
      });

      // Supabase에서 30일간의 데이터를 각 광고주별로 병렬(Promise.all) 일괄 조회하여 PostgREST 1,000건 제한 원천 회피!
      // Supabase Stored Procedure (RPC)를 가동하여 37개 전체 광고주의 30일 광고비 합산 연산을 DB 서버 내부에서 0.001초 만에 종결!
      let allCamps30Days: any[] = [];
      let errCamps: any = null;

      try {
        const { data, error } = await supabase
          .rpc('get_advertiser_30day_cost', {
            since_date: since30DaysStr,
            until_date: yesterdayStr,
            customer_ids_arr: customerIds
          });
        
        if (error) throw error;
        
        // 기존 프론트엔드 합산 로직과의 대칭 호환성을 위해,
        // RPC 반환 결과인 [{ customer_id: "...", yesterday_cost: 745089, total_30day_cost: 18105944 }]를
        // 어제 성과용 로우(date = yesterdayStr)와 과거 29일 누계용 로우(date = 'PRIOR') 2개로 쪼개어 가공합니다!
        const mappedRows: any[] = [];
        (data || []).forEach((row: any) => {
          const yesterdayVal = Number(row.yesterday_cost) || 0;
          const total30Val = Number(row.total_30day_cost) || 0;
          const priorVal = Math.max(0, total30Val - yesterdayVal);
          
          const details = yesterdayDetailMap[row.customer_id] || { imp: 0, clk: 0, purchase: 0, sales: 0 };

          // 1) 어제 하루치 레코드 (노출, 클릭, 구매완료수, 매출액 100% 매핑 복원!)
          mappedRows.push({
            customer_id: row.customer_id,
            sales_amt: yesterdayVal,
            imp_cnt: details.imp,
            clk_cnt: details.clk,
            purchase_ccnt: details.purchase,
            purchase_conv_amt: details.sales,
            date: yesterdayStr
          });
          
          // 2) 과거 29일치 레코드 (최근 30일 합산 시 s + sales_amt에 반영됨)
          mappedRows.push({
            customer_id: row.customer_id,
            sales_amt: priorVal,
            date: 'PRIOR'
          });
        });
        allCamps30Days = mappedRows;
      } catch (err: any) {
        errCamps = err;
      }

      if (errCamps) throw errCamps;

      console.log('8. DB에서 성공적으로 긁어온 30일 성과 행 개수 (allCamps30Days):', allCamps30Days?.length);

      const statsMap: { [key: string]: any[] } = {};
      customerIds.forEach(cid => { statsMap[cid] = []; });
      
      if (allCamps30Days) {
        allCamps30Days.forEach(row => {
          if (statsMap[row.customer_id]) {
            statsMap[row.customer_id].push(row);
          }
        });
      }

      const activeList: any[] = [];
      const alerts: any[] = [];

      let megaCost = 0;
      let megaImp = 0;
      let megaClk = 0;
      let megaPurchase = 0;
      let megaSales = 0;

      targetAccounts.forEach(acc => {
        const rows = statsMap[acc.customer_id] || [];
        if (rows.length === 0) return;

        // 1. 최근 30일 총 광고소진비 계산
        const total30Cost = rows.reduce((s, r) => s + (r.sales_amt || 0), 0);
        
        // 최근 30일 소진이 0원인 광고주는 무소진 휴면 계정으로 판단하여 집계/그리드에서 제외
        if (total30Cost === 0) return;

        // 2. 어제 성과와 직전 29일 성과 분리 집계
        const yesterdayRows = rows.filter(r => r.date === yesterdayStr);
        const priorRows = rows.filter(r => r.date !== yesterdayStr);

        const yesterdayCost = yesterdayRows.reduce((s, r) => s + (r.sales_amt || 0), 0);
        const yesterdayImp = yesterdayRows.reduce((s, r) => s + (r.imp_cnt || 0), 0);
        const yesterdayClk = yesterdayRows.reduce((s, r) => s + (r.clk_cnt || 0), 0);
        const yesterdayPurchase = yesterdayRows.reduce((s, r) => s + (r.purchase_ccnt || 0), 0);
        const yesterdaySales = yesterdayRows.reduce((s, r) => s + (r.purchase_conv_amt || 0), 0);

        const priorCostTotal = priorRows.reduce((s, r) => s + (r.sales_amt || 0), 0);
        // ⚡ V3.16.3: RPC 호출 시 과거 29일치 광고비가 단일 'PRIOR' 행으로 축약되므로, 실제 일평균을 구하기 위해 29일로 나누어 줍니다!
        const priorAvgCost = priorCostTotal / 29;

        // 3. 🚨 긴급 이상 징후 분석 (이제 테스터 USER도 본인 즐겨찾기에 한해 경보 혜택 제공!)
        if (priorAvgCost >= 10000) {
          if (yesterdayCost === 0) {
            alerts.push({
              ad_account_name: acc.ad_account_name,
              customer_id: acc.customer_id,
              type: 'ZERO',
              message: `평소 일 평균 **${formatNumber(Math.round(priorAvgCost))}원**을 소진하던 우량 업체이나, 어제 광고비 소진이 **0원**에 그쳐 완전히 중단(Zero)되었습니다! 긴급 점검이 필요합니다.`
            });
          } else {
            const costRatio = yesterdayCost / priorAvgCost;
            if (costRatio >= 2.0) {
              alerts.push({
                ad_account_name: acc.ad_account_name,
                customer_id: acc.customer_id,
                type: 'SURGE',
                message: `어제 광고 소진비가 평소(일 평균 ${formatNumber(Math.round(priorAvgCost))}원) 대비 **${((costRatio - 1) * 100).toFixed(0)}% 급증**한 **${formatNumber(Math.round(yesterdayCost))}원**에 달해 예산 폭증 경보가 발령되었습니다.`
              });
            } else if (costRatio <= 0.15) {
              alerts.push({
                ad_account_name: acc.ad_account_name,
                customer_id: acc.customer_id,
                type: 'DROP',
                message: `어제 광고 소진비가 평소(일 평균 ${formatNumber(Math.round(priorAvgCost))}원) 대비 **${((1 - costRatio) * 100).toFixed(0)}% 급감**한 **${formatNumber(Math.round(yesterdayCost))}원**에 그쳐 노출 누락 또는 이상이 우려됩니다.`
              });
            }
          }
        }

        // 4. 메가 합산 적립
        megaCost += yesterdayCost;
        megaImp += yesterdayImp;
        megaClk += yesterdayClk;
        megaPurchase += yesterdayPurchase;
        megaSales += yesterdaySales;

        activeList.push({
          ...acc,
          yesterdayCost,
          yesterdayImp,
          yesterdayClk,
          yesterdayPurchase,
          yesterdaySales,
          total30Cost,
          avgCtr: yesterdayImp > 0 ? (yesterdayClk / yesterdayImp) * 100 : 0,
          avgCpc: yesterdayClk > 0 ? Math.round(yesterdayCost / yesterdayClk) : 0,
          avgRoas: yesterdayCost > 0 ? (yesterdaySales / yesterdayCost) * 100 : 0
        });
      });

      // 5. 메가 서머리 계산
      setMegaSummary({
        totalCost: megaCost,
        totalImp: megaImp,
        totalClk: megaClk,
        totalPurchaseCcnt: megaPurchase,
        totalPurchaseConvAmt: megaSales,
        avgCtr: megaImp > 0 ? (megaClk / megaImp) * 100 : 0,
        avgCpc: megaClk > 0 ? Math.round(megaCost / megaClk) : 0,
        avgRoas: megaCost > 0 ? (megaSales / megaCost) * 100 : 0
      });

      // 소진 광고비 내림차순 정렬
      activeList.sort((a, b) => b.yesterdayCost - a.yesterdayCost);
      setActiveAdvertisers(activeList);
      setUrgentAlerts(alerts);

    } catch (err: any) {
      console.error('[Dashboard Portal] fetchPortalData 에러:', err.message);
    } finally {
      setPortalLoading(false);
    }
  };

  // 주요 계정 즐겨찾기(⭐️ 토글) 핸들러 추가
  const handleToggleFavorite = async (e: React.MouseEvent, customerId: string) => {
    e.stopPropagation(); // 광고주 변경 이벤트 전파 방지
    try {
      const response = await fetch('/api/sync/favorite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId })
      });
      const result = await response.json();
      if (result.success) {
        // 로컬 상태 즉시 실시간 토글 업데이트
        setAccounts(prev =>
          prev.map(acc =>
            acc.customer_id === customerId ? { ...acc, is_favorite: result.is_favorite } : acc
          )
        );
      } else {
        alert(result.error || '주요 계정 지정에 실패했습니다.');
      }
    } catch (err: any) {
      alert('서버와 통신하는 도중 오류가 발생했습니다.');
    }
  };

  // 2-0. Supabase 1,000개 기본 페이지네이션 제한 우회용 전체 데이터 병렬 조회 헬퍼 (결과 보장을 위한 결정적 정렬 및 격리 적용)
  const supabaseFetchAll = async (
    table: string,
    customerId: string,
    since: string,
    until: string
  ): Promise<any[]> => {
    let allData: any[] = [];
    let from = 0;
    const batchSize = 1000;
    
    // 페이지네이션 일관성을 보장하기 위해 고유 ID 컬럼 결정
    let idField = 'campaign_id';
    if (table === 'adgroup_stats') idField = 'adgroup_id';
    else if (table === 'ad_stats') idField = 'ad_id';
    
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('customer_id', customerId)
        .gte('date', since)
        .lte('date', until)
        .order('date', { ascending: true })
        .order(idField, { ascending: true })
        .range(from, from + batchSize - 1);
        
      if (error) throw error;
      if (!data || data.length === 0) break;
      allData.push(...data);
      if (data.length < batchSize) break;
      from += batchSize;
    }
    
    return allData;
  };

  // 2-0-1. Supabase 마스터 이름 조회용 전체 페이지네이션 헬퍼 (결과 보장을 위한 결정적 정렬 및 격리 적용)
  const supabaseFetchNames = async (
    table: string,
    customerId: string,
    idField: string,
    nameField: string
  ): Promise<any[]> => {
    let allData: any[] = [];
    let from = 0;
    const batchSize = 1000;
    
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select(`${idField}, ${nameField}`)
        .eq('customer_id', customerId)
        .order(idField, { ascending: true })
        .range(from, from + batchSize - 1);
        
      if (error) throw error;
      if (!data || data.length === 0) break;
      allData.push(...data);
      if (data.length < batchSize) break;
      from += batchSize;
    }
    
    return allData;
  };

  // 2-0-2. 마스터 이름 정보 캐시 병렬 로드 함수 (날짜 변경과 별개로 광고주 변경/동기화 시점에만 호출하여 불필요한 과부하 방지)
  const fetchMasterNames = async (customerId: string) => {
    if (!currentUser || !customerId) return;
    const filterUserId = currentUser.role === 'ADMIN' ? selectedUserFilter : currentUser.id;
    if (!filterUserId) return;

    try {
      const [campNamesData, adgNamesData] = await Promise.all([
        supabaseFetchNames('campaign_stats', customerId, 'campaign_id', 'campaign_name'),
        supabaseFetchNames('adgroup_stats', customerId, 'adgroup_id', 'adgroup_name')
      ]);

      if (campNamesData) {
        const cMap = new Map<string, string>();
        campNamesData.forEach(row => {
          if (row.campaign_id && row.campaign_name) {
            cMap.set(row.campaign_id, row.campaign_name);
          }
        });
        setCampaignMasterNames(cMap);
      }

      if (adgNamesData) {
        const aMap = new Map<string, string>();
        adgNamesData.forEach(row => {
          if (row.adgroup_id && row.adgroup_name) {
            aMap.set(row.adgroup_id, row.adgroup_name);
          }
        });
        setAdgroupMasterNames(aMap);
      }
    } catch (err: any) {
      console.error('Error loading master names:', err.message);
    }
  };

  // 2. 선택된 광고주의 지정 기간 캠페인, 광고그룹, 소재 데이터 조회 및 집계 (Supabase)
  const fetchCampaignAndAdGroupStats = async (customerId: string, forceSyncIfEmpty: boolean = true) => {
    if (!currentUser || !customerId) return;
    const filterUserId = currentUser.role === 'ADMIN' ? selectedUserFilter : currentUser.id;
    if (!filterUserId) return;

    // 비동기 요청 고유 ID 발급 및 기록
    const requestId = Date.now();
    activeRequestRef.current = requestId;

    try {
      // 새로운 조회 시작 즉시 이전 날짜의 데이터 잔상을 지워 UX 오해(오류 오인)를 방지합니다.
      setCampaigns([]);
      setAdgroups([]);
      setAds([]);
      setAnomalyFeed([]);
      setPopFeed([]);

      setLoadingCampaigns(true);
      setLoadingAdgroups(true);
      setLoadingAds(true);
      
      // 며칠간의 데이터가 필요한지 기대치 계산
      const startDate = new Date(since);
      const endDate = new Date(until);
      const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
      const expectedDaysVal = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      setExpectedDays(expectedDaysVal);

      // 직전 동등 기간 (PopPeriod) 지능형 매칭 구하기
      let popSince: string;
      let popUntil: string;
      let totalExpectedDays: number;

      const sinceParts = since.split('-');
      const sinceYear = parseInt(sinceParts[0], 10);
      const sinceMonth = parseInt(sinceParts[1], 10);
      const sinceDay = parseInt(sinceParts[2], 10);

      const untilParts = until.split('-');
      const untilYear = parseInt(untilParts[0], 10);
      const untilMonth = parseInt(untilParts[1], 10);
      const untilDay = parseInt(untilParts[2], 10);

      if (sinceDay === 1) {
        // [룰 1] 월의 1일부터 시작한 경우 -> 직전 월의 1일부터 동일 일자(N일)까지 대조 (예: 5/1~5/25 -> 4/1~4/25)
        let prevYear = sinceYear;
        let prevMonth = sinceMonth - 1;
        if (prevMonth === 0) {
          prevMonth = 12;
          prevYear -= 1;
        }

        const pad = (n: number) => String(n).padStart(2, '0');
        popSince = `${prevYear}-${pad(prevMonth)}-01`;

        const lastDayOfPrevMonth = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
        const targetUntilDay = Math.min(untilDay, lastDayOfPrevMonth);
        popUntil = `${prevYear}-${pad(prevMonth)}-${pad(targetUntilDay)}`;
        
        totalExpectedDays = expectedDaysVal + targetUntilDay;
      } else {
        // [룰 2] 그 외 일반 기간 (예: 최근 7일) -> 직전 7일(일주일) 전 동일 요일 세트로 대조하여 주말/평일 노이즈 제거 (예: 5/11~5/13 -> 5/4~5/6)
        const popSinceDate = new Date(startDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        const popUntilDate = new Date(popSinceDate.getTime() + (expectedDaysVal - 1) * 24 * 60 * 60 * 1000);
        
        const formatDate = (d: Date) => {
          const year = d.getUTCFullYear();
          const month = String(d.getUTCMonth() + 1).padStart(2, '0');
          const day = String(d.getUTCDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        };

        popSince = formatDate(popSinceDate);
        popUntil = formatDate(popUntilDate);
        
        // 두 기간 사이의 공백(Gap)을 포함한 전체 범위 날짜 수 동적 연산
        const gapTime = Math.abs(endDate.getTime() - popSinceDate.getTime());
        totalExpectedDays = Math.ceil(gapTime / (1000 * 60 * 60 * 24)) + 1;
      }

      // DB에서 popSince부터 until까지 전체 범위 데이터 병렬 조회 (페이지네이션, 정렬 및 격리 적용)
      const [allCampData, allAdgData, allAdData] = await Promise.all([
        supabaseFetchAll('campaign_stats', customerId, popSince, until),
        supabaseFetchAll('adgroup_stats', customerId, popSince, until),
        supabaseFetchAll('ad_stats', customerId, popSince, until)
      ]);

      // 메인 테이블 표시용으로 현재 날짜 범위에만 속하는 데이터 분리 필터링
      const currentCampData = allCampData.filter(row => row.date >= since && row.date <= until);
      const currentAdgData = allAdgData.filter(row => row.date >= since && row.date <= until);
      const currentAdData = allAdData.filter(row => row.date >= since && row.date <= until);

      // DB에 이전 동등 기간 + 현재 기간을 아우르는 전체 고유 날짜 수 계산 (popSince ~ until 기준)
      const distinctDatesInDb = new Set(allCampData.map(row => row.date)).size;

      // ⚡ V3.16.5: 대표님의 기획 설계 정적 롤백 복원
      // 개별 대시보드 진입 시, 이전 동등 비교 기간(PoP) 데이터가 DB에 없다면 당연히 실시간 API 동기화를 가동하여 전월 데이터까지 함께 미리 긁어오는 것이 맞습니다!
      if ((allCampData.length === 0 || allAdgData.length === 0 || distinctDatesInDb < totalExpectedDays) && forceSyncIfEmpty) {
        console.log(`[Dashboard] DB 내 이전 동등 기간 포함 범위(${popSince} ~ ${until})의 데이터가 불완전함 (가져온 날짜 수: ${distinctDatesInDb}/${totalExpectedDays}일). 실시간 동기화...`);
        await handleSyncCampaigns(customerId, popSince);
      } else {
        // 비동기 요청 엇갈림 검증 (B요청이 처리된 후 도착한 낡은 A요청 결과 버림)
        if (requestId !== activeRequestRef.current) {
          console.log('[Dashboard] 엇갈린 과거 비동기 조회 요청(fetch) 결과 드롭 처리 완료.');
          return;
        }

        // 현재 메인 조회 기간(since ~ until) 기준 DB에 실제로 들어있는 고유 날짜 수 계산
        const activeDistinctDates = new Set(currentCampData.map(row => row.date));
        const activeDistinctCount = activeDistinctDates.size;
        setDbDistinctDatesCount(activeDistinctCount);

        // 데이터가 듬성듬성 비어있는 상태 감지 (0개 초과 && 기대 일수보다 적음)
        if (activeDistinctCount > 0 && activeDistinctCount < expectedDaysVal) {
          setShowDataGapBanner(true);
        } else {
          setShowDataGapBanner(false);
        }

        aggregateAndSetCampaigns(currentCampData);
        aggregateAndSetAdgroups(currentAdgData);
        aggregateAndSetAds(currentAdData);
        // AI 성능 변동 및 이상 징후 감지 엔진 실시간 구동 (전체 범위 데이터 및 동등 기간 전달)
        runInsightEngine(allCampData, allAdgData, allAdData, since, until, popSince, popUntil);
      }
    } catch (err: any) {
      console.error('Error fetching campaign & adgroup & ad stats:', err.message);
    } finally {
      setLoadingCampaigns(false);
      setLoadingAdgroups(false);
      setLoadingAds(false);
    }
  };

  // 3. 캠페인별 그룹 합산(Aggregation) 및 정밀 비율 재연산
  const aggregateAndSetCampaigns = (rawStats: any[]) => {
    const grouped: { [key: string]: CampaignStat } = {};

    rawStats.forEach(row => {
      const cid = row.campaign_id;
      if (!grouped[cid]) {
        grouped[cid] = {
          campaign_id: cid,
          date: `${since} ~ ${until}`,
          campaign_name: row.campaign_name,
          campaign_type: row.campaign_type,
          campaign_status: row.campaign_status,
          daily_budget: row.daily_budget,
          imp_cnt: 0,
          clk_cnt: 0,
          ctr: 0,
          cpc: 0,
          sales_amt: 0,
          ccnt: 0,
          crto: 0,
          conv_amt: 0,
          ror: 0,
          cp_conv: 0,
          purchase_ccnt: 0,
          purchase_conv_amt: 0,
          purchase_ror: 0
        };
      }
      
      grouped[cid].imp_cnt += row.imp_cnt || 0;
      grouped[cid].clk_cnt += row.clk_cnt || 0;
      grouped[cid].sales_amt += row.sales_amt || 0;
      grouped[cid].ccnt += row.ccnt || 0;
      grouped[cid].conv_amt += row.conv_amt || 0;
      grouped[cid].purchase_ccnt += row.purchase_ccnt || 0;
      grouped[cid].purchase_conv_amt += row.purchase_conv_amt || 0;
    });

    const aggregatedList = Object.values(grouped).map(camp => {
      camp.ctr = camp.imp_cnt > 0 ? (camp.clk_cnt / camp.imp_cnt) * 100 : 0;
      camp.cpc = camp.clk_cnt > 0 ? camp.sales_amt / camp.clk_cnt : 0;
      camp.crto = camp.clk_cnt > 0 ? (camp.ccnt / camp.clk_cnt) * 100 : 0;
      camp.ror = camp.sales_amt > 0 ? (camp.conv_amt / camp.sales_amt) * 100 : 0;
      camp.purchase_ror = camp.sales_amt > 0 ? (camp.purchase_conv_amt / camp.sales_amt) * 100 : 0;
      camp.cp_conv = camp.ccnt > 0 ? camp.sales_amt / camp.ccnt : 0;
      return camp;
    });

    setCampaigns(aggregatedList);
  };

  // 3-2. 광고그룹별 그룹 합산(Aggregation) 및 정밀 비율 재연산
  const aggregateAndSetAdgroups = (rawStats: any[]) => {
    const grouped: { [key: string]: AdGroupStat } = {};

    rawStats.forEach(row => {
      const gid = row.adgroup_id;
      if (!grouped[gid]) {
        grouped[gid] = {
          adgroup_id: gid,
          date: `${since} ~ ${until}`,
          campaign_id: row.campaign_id,
          adgroup_name: row.adgroup_name,
          adgroup_type: row.adgroup_type,
          adgroup_status: row.adgroup_status,
          daily_budget: row.daily_budget,
          bid_amt: row.bid_amt,
          imp_cnt: 0,
          clk_cnt: 0,
          ctr: 0,
          cpc: 0,
          sales_amt: 0,
          ccnt: 0,
          crto: 0,
          conv_amt: 0,
          ror: 0,
          cp_conv: 0,
          purchase_ccnt: 0,
          purchase_conv_amt: 0,
          purchase_ror: 0
        };
      }
      
      grouped[gid].imp_cnt += row.imp_cnt || 0;
      grouped[gid].clk_cnt += row.clk_cnt || 0;
      grouped[gid].sales_amt += row.sales_amt || 0;
      grouped[gid].ccnt += row.ccnt || 0;
      grouped[gid].conv_amt += row.conv_amt || 0;
      grouped[gid].purchase_ccnt += row.purchase_ccnt || 0;
      grouped[gid].purchase_conv_amt += row.purchase_conv_amt || 0;
    });

    const aggregatedList = Object.values(grouped).map(adg => {
      adg.ctr = adg.imp_cnt > 0 ? (adg.clk_cnt / adg.imp_cnt) * 100 : 0;
      adg.cpc = adg.clk_cnt > 0 ? adg.sales_amt / adg.clk_cnt : 0;
      adg.crto = adg.clk_cnt > 0 ? (adg.ccnt / adg.clk_cnt) * 100 : 0;
      adg.ror = adg.sales_amt > 0 ? (adg.conv_amt / adg.sales_amt) * 100 : 0;
      adg.purchase_ror = adg.sales_amt > 0 ? (adg.purchase_conv_amt / adg.sales_amt) * 100 : 0;
      adg.cp_conv = adg.ccnt > 0 ? adg.sales_amt / adg.ccnt : 0;
      return adg;
    });

    setAdgroups(aggregatedList);
  };

  // 3-3. 소재별 그룹 합산(Aggregation) 및 정밀 비율 재연산
  const aggregateAndSetAds = (rawStats: any[]) => {
    const grouped: { [key: string]: AdStat } = {};

    rawStats.forEach(row => {
      const aid = row.ad_id;
      if (!grouped[aid]) {
        grouped[aid] = {
          ad_id: aid,
          date: `${since} ~ ${until}`,
          campaign_id: row.campaign_id,
          adgroup_id: row.adgroup_id,
          ad_name: row.ad_name,
          ad_type: row.ad_type,
          ad_status: row.ad_status,
          inspect_status: row.inspect_status,
          imp_cnt: 0,
          clk_cnt: 0,
          ctr: 0,
          cpc: 0,
          sales_amt: 0,
          ccnt: 0,
          crto: 0,
          conv_amt: 0,
          ror: 0,
          cp_conv: 0,
          purchase_ccnt: 0,
          purchase_conv_amt: 0,
          purchase_ror: 0
        };
      }
      
      grouped[aid].imp_cnt += row.imp_cnt || 0;
      grouped[aid].clk_cnt += row.clk_cnt || 0;
      grouped[aid].sales_amt += row.sales_amt || 0;
      grouped[aid].ccnt += row.ccnt || 0;
      grouped[aid].conv_amt += row.conv_amt || 0;
      grouped[aid].purchase_ccnt += row.purchase_ccnt || 0;
      grouped[aid].purchase_conv_amt += row.purchase_conv_amt || 0;
    });

    const aggregatedList = Object.values(grouped).map(adItem => {
      adItem.ctr = adItem.imp_cnt > 0 ? (adItem.clk_cnt / adItem.imp_cnt) * 100 : 0;
      adItem.cpc = adItem.clk_cnt > 0 ? adItem.sales_amt / adItem.clk_cnt : 0;
      adItem.crto = adItem.clk_cnt > 0 ? (adItem.ccnt / adItem.clk_cnt) * 100 : 0;
      adItem.ror = adItem.sales_amt > 0 ? (adItem.conv_amt / adItem.sales_amt) * 100 : 0;
      adItem.purchase_ror = adItem.sales_amt > 0 ? (adItem.purchase_conv_amt / adItem.sales_amt) * 100 : 0;
      adItem.cp_conv = adItem.ccnt > 0 ? adItem.sales_amt / adItem.ccnt : 0;
      return adItem;
    });

    setAds(aggregatedList);
  };

  // 4. 네이버 API 광고주 목록 동기화
  const handleSyncAccounts = async () => {
    if (!currentUser) return;
    try {
      setSyncingAccounts(true);
      
      // ADMIN이 대리동기화 중이면 대상 targetUserId 전달
      let url = '/api/sync/accounts';
      if (currentUser.role === 'ADMIN' && selectedUserFilter) {
        url += `?targetUserId=${selectedUserFilter}`;
      }

      const response = await fetch(url, { method: 'POST' });
      const result = await response.json();
      
      if (result.success) {
        alert(`${result.message}\n(동기화 완료 계정 수: ${result.details.synced_accounts_count}개)`);
        await fetchAccounts();
      } else {
        alert(`광고주 동기화 실패: ${result.error}`);
      }
    } catch (err: any) {
      alert(`광고주 동기화 중 오류 발생: ${err.message}`);
    } finally {
      setSyncingAccounts(false);
    }
  };

  // 5. 특정 광고주 지정 기간의 캠페인 및 광고그룹 통계 실시간 동기화 (SSE 스트리밍 진행률 연동)
  const handleSyncCampaigns = async (customerId: string, syncSince?: string, isManualForce: boolean = false) => {
    if (!currentUser || !customerId) return;
    const filterUserId = currentUser.role === 'ADMIN' ? selectedUserFilter : currentUser.id;
    if (!filterUserId) return;

    const requestId = Date.now();
    activeRequestRef.current = requestId;

    try {
      setSyncingCampaigns(true);
      setSyncProgress(0);
      setSyncStage('INITIALIZE');
      setSyncMessage('동기화 준비 및 날짜 분할 중...');

      let actualSince = syncSince || since;
      let actualUntil = until;

      // syncSince가 없고 datePreset이 custom이 아닐 때 실제 KST 기준 시작-종료 날짜 계산
      if (!syncSince && datePreset !== 'custom') {
        const now = new Date();
        const kstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        const yesterday = new Date(kstNow.getTime() - (24 * 60 * 60 * 1000));
        
        const pad = (n: number) => String(n).padStart(2, '0');
        const formatDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
        
        let sDate = yesterday;
        let uDate = yesterday;

        switch (datePreset) {
          case 'last7days':
            sDate = new Date(yesterday.getTime() - (6 * 24 * 60 * 60 * 1000));
            break;
          case 'last30days':
            sDate = new Date(yesterday.getTime() - (29 * 24 * 60 * 60 * 1000));
            break;
          case 'lastweek': {
            const currentDay = kstNow.getUTCDay();
            const daysToLastMonday = (currentDay === 0 ? 7 : currentDay) + 6;
            sDate = new Date(kstNow.getTime() - (daysToLastMonday * 24 * 60 * 60 * 1000));
            uDate = new Date(sDate.getTime() + (6 * 24 * 60 * 60 * 1000));
            break;
          }
          case 'lastmonth': {
            const year = kstNow.getUTCFullYear();
            const month = kstNow.getUTCMonth();
            sDate = new Date(Date.UTC(year, month - 1, 1));
            uDate = new Date(Date.UTC(year, month, 0));
            break;
          }
        }
        actualSince = formatDate(sDate);
        actualUntil = formatDate(uDate);
      }

      const startDate = new Date(actualSince);
      const endDate = new Date(actualUntil);
      const diffDays = Math.ceil(Math.abs(endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const limitDays = Math.min(diffDays, 90);
      
      const allDates: string[] = [];
      const pad2 = (n: number) => String(n).padStart(2, '0');
      for(let i=0; i<limitDays; i++) {
        const d = new Date(startDate.getTime() + (i * 24 * 60 * 60 * 1000));
        allDates.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`);
      }

      const chunkSize = 5;
      const chunks = [];
      for(let i=0; i<allDates.length; i+=chunkSize) {
        const chunkDates = allDates.slice(i, i+chunkSize);
        chunks.push({
          since: chunkDates[0],
          until: chunkDates[chunkDates.length - 1]
        });
      }

      let errorOccurred = false;
      let errorMessage = '';

      // ⚡ [캠페인 단위 분할 동기화] 1단계: 동기화 대상 캠페인 목록만 신속하게 사전 로드
      setSyncMessage('동기화 대상 캠페인 목록을 조회하는 중...');
      let campaignsToSync: any[] = [];
      try {
        let url = `/api/sync/campaigns?customerId=${customerId}&onlyCampaigns=true`;
        if (currentUser.role === 'ADMIN' && selectedUserFilter) {
          url += `&targetUserId=${selectedUserFilter}`;
        }
        const response = await fetch(url, { method: 'POST' });
        if (response.ok) {
          const result = await response.json();
          if (result.success && Array.isArray(result.campaigns)) {
            campaignsToSync = result.campaigns;
            console.log(`[Dashboard] 사전 수집된 캠페인 개수: ${campaignsToSync.length}개`);
          }
        }
      } catch (e) {
        console.error('[Dashboard] 캠페인 목록 사전 조회 실패 (폴백 진행):', e);
      }

      // ⚡ 2단계: 캠페인 목록이 있을 경우 [캠페인 x 날짜] 이중 분할 루프 작동
      if (campaignsToSync.length > 0) {
        const totalSteps = chunks.length * campaignsToSync.length;
        let currentStep = 0;

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];

          for (const camp of campaignsToSync) {
            currentStep++;
            const campName = camp.campaignName || camp.name || '캠페인';

            let url = `/api/sync/campaigns?customerId=${customerId}&since=${chunk.since}&until=${chunk.until}&isManualForce=${isManualForce}&campaignId=${camp.nccCampaignId}`;
            if (currentUser.role === 'ADMIN' && selectedUserFilter) {
              url += `&targetUserId=${selectedUserFilter}`;
            }

            const response = await fetch(url, { method: 'POST' });
            if (!response.ok) {
              throw new Error(`[${campName}] 동기화 서버 연결 실패 (HTTP ${response.status})`);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            if (!reader) throw new Error('스트리밍 리더를 설정할 수 없습니다.');

            while (true) {
              const { value, done } = await reader.read();
              if (done) break;

              const chunkText = decoder.decode(value, { stream: true });
              const lines = chunkText.split('\n');
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6));
                    if (data.error) {
                      errorOccurred = true;
                      errorMessage = `[${campName}] ${data.error}`;
                      break;
                    }
                    if (data.progress !== undefined) {
                      const baseProgress = ((currentStep - 1) / totalSteps) * 100;
                      const stepProgress = (data.progress / 100) * (100 / totalSteps);
                      setSyncProgress(Math.min(100, Math.round(baseProgress + stepProgress)));
                      setSyncStage(data.stage || '');
                      setSyncMessage(`[${currentStep}/${totalSteps} 캠페인: ${campName}] ${data.message || ''}`);
                    }
                  } catch (e) {}
                }
              }
              if (errorOccurred) break;
            }
            if (errorOccurred) break;
          }
          if (errorOccurred) break;
        }
      } else {
        // [폴백 흐름]: 캠페인 조회가 실패한 경우 기존 단일 날짜 청킹 루프 작동
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];

          let url = `/api/sync/campaigns?customerId=${customerId}&since=${chunk.since}&until=${chunk.until}&isManualForce=${isManualForce}`;
          if (currentUser.role === 'ADMIN' && selectedUserFilter) {
            url += `&targetUserId=${selectedUserFilter}`;
          }

          const response = await fetch(url, { method: 'POST' });
          if (!response.ok) {
            throw new Error(`동기화 서버 연결에 실패했습니다. (HTTP ${response.status})`);
          }

          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          if (!reader) throw new Error('스트리밍 리더를 설정할 수 없습니다.');

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            const chunkText = decoder.decode(value, { stream: true });
            const lines = chunkText.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.error) {
                    errorOccurred = true;
                    errorMessage = data.error;
                    break;
                  }
                  if (data.progress !== undefined) {
                    const baseProgress = (i / chunks.length) * 100;
                    const chunkProgress = data.progress / chunks.length;
                    setSyncProgress(Math.min(100, Math.round(baseProgress + chunkProgress)));
                    setSyncStage(data.stage || '');
                    setSyncMessage(`[${i+1}/${chunks.length} 구간: ${chunk.since}~${chunk.until}] ${data.message || ''}`);
                  }
                } catch (e) {}
              }
            }
            if (errorOccurred) break;
          }
          if (errorOccurred) break;
        }
      }

      if (errorOccurred) {
        throw new Error(errorMessage || '동기화 중 에러가 보고되었습니다.');
      }

      const [campData, adgData, adData] = await Promise.all([
        supabaseFetchAll('campaign_stats', customerId, actualSince, actualUntil),
        supabaseFetchAll('adgroup_stats', customerId, actualSince, actualUntil),
        supabaseFetchAll('ad_stats', customerId, actualSince, actualUntil)
      ]);

      fetchMasterNames(customerId);

      const currentCampData = campData.filter(row => row.date >= since && row.date <= until);
      const currentAdgData = adgData.filter(row => row.date >= since && row.date <= until);
      const currentAdData = adData.filter(row => row.date >= since && row.date <= until);

      if (requestId !== activeRequestRef.current) {
        console.log('[Dashboard] 엇갈린 과거 비동기 동기화(sync) 요청 결과 드롭 처리 완료.');
        return;
      }

      aggregateAndSetCampaigns(currentCampData);
      aggregateAndSetAdgroups(currentAdgData);
      aggregateAndSetAds(currentAdData);
      
      // AI 성능 변동 및 이상 징후 감지 엔진 실시간 구동 (전체 범위 데이터 및 동등 기간 전달)
      const expectedDaysVal = Math.ceil(Math.abs(new Date(until).getTime() - new Date(since).getTime()) / (1000 * 60 * 60 * 24)) + 1;
      
      let calculatedPopSince: string;
      let calculatedPopUntil: string;

      const sinceParts = since.split('-');
      const sinceYear = parseInt(sinceParts[0], 10);
      const sinceMonth = parseInt(sinceParts[1], 10);
      const sinceDay = parseInt(sinceParts[2], 10);

      const untilParts = until.split('-');
      const untilYear = parseInt(untilParts[0], 10);
      const untilMonth = parseInt(untilParts[1], 10);
      const untilDay = parseInt(untilParts[2], 10);

      if (sinceDay === 1) {
        let prevYear = sinceYear;
        let prevMonth = sinceMonth - 1;
        if (prevMonth === 0) {
          prevMonth = 12;
          prevYear -= 1;
        }

        const pad = (n: number) => String(n).padStart(2, '0');
        calculatedPopSince = `${prevYear}-${pad(prevMonth)}-01`;

        const lastDayOfPrevMonth = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
        const targetUntilDay = Math.min(untilDay, lastDayOfPrevMonth);
        calculatedPopUntil = `${prevYear}-${pad(prevMonth)}-${pad(targetUntilDay)}`;
      } else {
        // [룰 2] 그 외 일반 기간 -> 직전 7일(일주일) 전 동일 요일 세트로 대조
        const popSinceDate = new Date(new Date(since).getTime() - 7 * 24 * 60 * 60 * 1000);
        const popUntilDate = new Date(popSinceDate.getTime() + (expectedDaysVal - 1) * 24 * 60 * 60 * 1000);
        const formatDate = (d: Date) => {
          const year = d.getUTCFullYear();
          const month = String(d.getUTCMonth() + 1).padStart(2, '0');
          const day = String(d.getUTCDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        };
        calculatedPopSince = formatDate(popSinceDate);
        calculatedPopUntil = formatDate(popUntilDate);
      }

      runInsightEngine(campData, adgData, adData, since, until, calculatedPopSince, calculatedPopUntil);
      
      // 동기화가 성공 완료되었으므로 누락 감지 배너 및 차단 플래그 리셋
      setShowDataGapBanner(false);
      setDismissDataGapBanner(false);

      // 광고주 리스트의 갱신 시각 업데이트
      await fetchAccounts();

    } catch (err: any) {
      alert(`동기화 중 오류 발생: ${err.message}`);
    } finally {
      setSyncingCampaigns(false);
      setSyncProgress(0);
    }
  };

  // 지능형 누락 배너에서 호출하는 빠진 데이터 원클릭 스트리밍 동기화 함수 (V3.11)
  const handleSyncGapData = () => {
    if (!selectedAccountId) return;
    const startDate = new Date(since);
    const endDate = new Date(until);
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    const expectedDaysVal = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    let popSince: string;

    const sinceParts = since.split('-');
    const sinceYear = parseInt(sinceParts[0], 10);
    const sinceMonth = parseInt(sinceParts[1], 10);
    const sinceDay = parseInt(sinceParts[2], 10);

    if (sinceDay === 1) {
      let prevYear = sinceYear;
      let prevMonth = sinceMonth - 1;
      if (prevMonth === 0) {
        prevMonth = 12;
        prevYear -= 1;
      }
      const pad = (n: number) => String(n).padStart(2, '0');
      popSince = prevYear + '-' + pad(prevMonth) + '-01';
    } else {
      const popSinceDate = new Date(startDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      const formatDate = (d: Date) => {
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
      };
      popSince = formatDate(popSinceDate);
    }
    handleSyncCampaigns(selectedAccountId, popSince);
  };

  // 테이블 정렬 핸들러
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  };

  // 아코디언 토글 핸들러
  const toggleCampaignExpand = (campaignId: string) => {
    const newSet = new Set(expandedCampaignIds);
    if (newSet.has(campaignId)) {
      newSet.delete(campaignId);
    } else {
      newSet.add(campaignId);
    }
    setExpandedCampaignIds(newSet);
  };

  // 광고그룹 아코디언 토글 핸들러 (소재 전개용)
  const toggleAdgroupExpand = (adgroupId: string) => {
    const newSet = new Set(expandedAdgroupIds);
    if (newSet.has(adgroupId)) {
      newSet.delete(adgroupId);
    } else {
      newSet.add(adgroupId);
    }
    setExpandedAdgroupIds(newSet);
  };

  // CSV 다운로드 엔진
  const downloadCSV = () => {
    if (!activeAccount) return;

    const isCamp = activeTab === 'campaign';
    const isAdg = activeTab === 'adgroup';
    const isAd = activeTab === 'ad';

    const dataToExport = isCamp 
      ? filteredCampaigns 
      : isAdg 
        ? filteredAdgroups 
        : filteredAds;

    if (dataToExport.length === 0) {
      alert('내보낼 데이터가 없습니다.');
      return;
    }

    // 캠페인 정보 맵 구성 (광고그룹 및 소재 다운로드 시 캠페인 이름 매핑용)
    const campMapForExport = new Map(campaigns.map(c => [c.campaign_id, c.campaign_name]));
    // 광고그룹 정보 맵 구성 (소재 다운로드 시 광고그룹 이름 매핑용)
    const adgMapForExport = new Map(adgroups.map(g => [g.adgroup_id, g.adgroup_name]));

    // CSV 한글 헤더 구성 (모든 전환 지표는 "구매완료" 지표로 100% 매핑하여 한글 치환)
    let headers: string[] = [];
    if (isCamp) {
      headers = ['캠페인명', '유형', '상태', '노출수(회)', '클릭수(회)', '클릭률(CTR)', '평균 CPC(원)', '소진광고비(원)', '구매완료수(건)', '구매완료율(%)', '구매완료매출액(원)', '구매완료 ROAS(%)'];
    } else if (isAdg) {
      headers = ['광고그룹명', '소속캠페인명', '유형', '상태', '기본입찰가(원)', '노출수(회)', '클릭수(회)', '클릭률(CTR)', '평균 CPC(원)', '소진광고비(원)', '구매완료수(건)', '구매완료율(%)', '구매완료매출액(원)', '구매완료 ROAS(%)'];
    } else {
      headers = ['소재명', '소속광고그룹명', '소속캠페인명', '소재유형', '소재상태', '검수상태', '노출수(회)', '클릭수(회)', '클릭률(CTR)', '평균 CPC(원)', '소진광고비(원)', '구매완료수(건)', '구매완료율(%)', '구매완료매출액(원)', '구매완료 ROAS(%)'];
    }

    // CSV 데이터 바디 생성
    const rows = dataToExport.map(item => {
      const imp = item.imp_cnt || 0;
      const clk = item.clk_cnt || 0;
      const cost = item.sales_amt || 0;
      const purchaseCcnt = item.purchase_ccnt || 0;
      const purchaseConvAmt = item.purchase_conv_amt || 0;

      // 수학적 정합성을 가지는 구매완료율 및 ROAS 재계산
      const ctr = imp > 0 ? ((clk / imp) * 100).toFixed(2) : '0.00';
      const cpc = clk > 0 ? Math.round(cost / clk) : 0;
      const purchaseCrto = clk > 0 ? ((purchaseCcnt / clk) * 100).toFixed(2) : '0.00';
      const purchaseRor = cost > 0 ? ((purchaseConvAmt / cost) * 100).toFixed(1) : '0.0';

      if (isCamp) {
        const camp = item as CampaignStat;
        return [
          `"${camp.campaign_name.replace(/"/g, '""')}"`,
          `"${camp.campaign_type}"`,
          `"${camp.campaign_status === 'ELIGIBLE' ? '노출가능' : '노출제한'}"`,
          imp,
          clk,
          `"${ctr}%"`,
          cpc,
          cost,
          purchaseCcnt,
          `"${purchaseCrto}%"`,
          Math.round(purchaseConvAmt),
          `"${purchaseRor}%"`
        ];
      } else if (isAdg) {
        const adg = item as AdGroupStat;
        const campName = campMapForExport.get(adg.campaign_id) || campaignMasterNames.get(adg.campaign_id) || '알 수 없는 캠페인';
        return [
          `"${adg.adgroup_name.replace(/"/g, '""')}"`,
          `"${campName.replace(/"/g, '""')}"`,
          `"${adg.adgroup_type}"`,
          `"${adg.adgroup_status === 'ELIGIBLE' ? '노출가능' : '노출제한'}"`,
          adg.bid_amt || 0,
          imp,
          clk,
          `"${ctr}%"`,
          cpc,
          cost,
          purchaseCcnt,
          `"${purchaseCrto}%"`,
          Math.round(purchaseConvAmt),
          `"${purchaseRor}%"`
        ];
      } else {
        const adItem = item as AdStat;
        const adgName = adgMapForExport.get(adItem.adgroup_id) || adgroupMasterNames.get(adItem.adgroup_id) || '알 수 없는 광고그룹';
        const campName = campMapForExport.get(adItem.campaign_id) || campaignMasterNames.get(adItem.campaign_id) || '알 수 없는 캠페인';
        return [
          `"${adItem.ad_name.replace(/"/g, '""')}"`,
          `"${adgName.replace(/"/g, '""')}"`,
          `"${campName.replace(/"/g, '""')}"`,
          `"${adItem.ad_type}"`,
          `"${adItem.ad_status === 'ELIGIBLE' ? '노출가능' : '노출제한'}"`,
          `"${adItem.inspect_status === 'APPROVED' ? '승인완료' : adItem.inspect_status}"`,
          imp,
          clk,
          `"${ctr}%"`,
          cpc,
          cost,
          purchaseCcnt,
          `"${purchaseCrto}%"`,
          Math.round(purchaseConvAmt),
          `"${purchaseRor}%"`
        ];
      }
    });

    // CSV 파일 조합
    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    
    // Excel 더블클릭 시 한글 절대 깨짐 방지를 위해 UTF-8 BOM (\ufeff) 선두 바이트 주입
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);

    const dateStr = datePreset === 'yesterday' ? since : `${since}_~_${until}`;
    let tabLabel = '캠페인';
    if (isAdg) tabLabel = '광고그룹';
    if (isAd) tabLabel = '소재';
    const filename = `${activeAccount.ad_account_name}_[${dateStr}]_${tabLabel}_구매완료기준_성과분석.csv`;

    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 초기 마운트 시 인증 체크
  useEffect(() => {
    fetchCurrentUser();

    const now = new Date();
    const kstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const yesterday = new Date(kstNow.getTime() - (24 * 60 * 60 * 1000));
    const formatDate = (d: Date) => {
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const yesterdayStr = formatDate(yesterday);
    setCustomSince(yesterdayStr);
    setCustomUntil(yesterdayStr);
    setAppliedCustomSince(yesterdayStr);
    setAppliedCustomUntil(yesterdayStr);
  }, []);

  // ADMIN 권한인 경우 전체 유저 목록 로드 및 필터링 감시
  useEffect(() => {
    if (currentUser?.role === 'ADMIN') {
      fetchUsersList();
    }
  }, [currentUser]);

  // 유저 필터 혹은 광고주 선택 시 계정 재갱신
  useEffect(() => {
    if (currentUser) {
      fetchAccounts();
      setSelectedAccountId('');
      setCampaigns([]);
      setAdgroups([]);
      setAds([]);
      setBizmoneyBalance(null);
    }
  }, [currentUser, selectedUserFilter]);

  // V3.14: selectedAccountId가 없고 accounts가 로드되었을 때 통합 포털 데이터 호출
  useEffect(() => {
    if (currentUser && !selectedAccountId && accounts.length > 0) {
      fetchPortalData();
    }
  }, [currentUser, selectedAccountId, accounts]);

  // 선택된 계정, 날짜 프리셋 또는 커스텀 날짜 범위가 바뀔 때마다 캠페인, 광고그룹, 소재 데이터를 갱신
  useEffect(() => {
    if (selectedAccountId) {
      if (datePreset === 'custom' && (!appliedCustomSince || !appliedCustomUntil)) return;
      
      // 계정이나 날짜가 변경되었으므로 배너 숨김(X) 상태를 초기화합니다.
      setDismissDataGapBanner(false);

      fetchCampaignAndAdGroupStats(selectedAccountId, true);

      // 날짜 일수 계산을 바탕으로 스마트 탭 스위칭 (1일 범위면 'campaign', 2일 이상 범위면 'briefing' 탭 활성화)
      const { since: sDate, until: uDate } = getKstDateRange(datePreset);
      const start = new Date(sDate);
      const end = new Date(uDate);
      const diffTime = Math.abs(end.getTime() - start.getTime());
      const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

      if (days >= 2) {
        setActiveTab('briefing');
      } else {
        setActiveTab('campaign');
      }
    } else {
      setCampaigns([]);
      setAdgroups([]);
      setAds([]);
    }
    setExpandedCampaignIds(new Set());
    setExpandedAdgroupIds(new Set());
  }, [selectedAccountId, datePreset, appliedCustomSince, appliedCustomUntil]);

  // 선택된 계정이 바뀔 때만 마스터 이름 캐시 및 실시간 비즈머니 로드
  useEffect(() => {
    if (selectedAccountId) {
      fetchMasterNames(selectedAccountId);
      fetchBizmoneyBalance(selectedAccountId);
    } else {
      setCampaignMasterNames(new Map());
      setAdgroupMasterNames(new Map());
      setBizmoneyBalance(null);
    }
  }, [selectedAccountId]);

  const activeAccount = accounts.find(acc => acc.customer_id === selectedAccountId);

  // 광고주 검색 필터 및 즐겨찾기(is_favorite) 우선 정렬
  const filteredAccounts = accounts
    .filter(acc => {
      const term = accountSearchTerm.toLowerCase();
      return (
        acc.ad_account_name.toLowerCase().includes(term) ||
        acc.customer_id.includes(term)
      );
    })
    .sort((a, b) => {
      const aFav = a.is_favorite ? 1 : 0;
      const bFav = b.is_favorite ? 1 : 0;
      
      // 1. 즐겨찾기(is_favorite = true)된 계정을 최상단으로 우선 정렬 (내림차순)
      if (aFav !== bFav) {
        return bFav - aFav;
      }
      
      // 2. 즐겨찾기 여부가 같다면, 광고주명 오름차순으로 사전식 정렬
      return a.ad_account_name.localeCompare(b.ad_account_name);
    });

  // 종합 통계 집계 계산
  const summary = campaigns.reduce(
    (acc, curr) => {
      acc.totalImp += curr.imp_cnt;
      acc.totalClk += curr.clk_cnt;
      acc.totalCost += curr.sales_amt;
      acc.totalCcnt += curr.ccnt;
      acc.totalConvAmt += curr.conv_amt;
      acc.totalPurchaseCcnt += curr.purchase_ccnt;
      acc.totalPurchaseConvAmt += curr.purchase_conv_amt;
      return acc;
    },
    {
      totalImp: 0,
      totalClk: 0,
      totalCost: 0,
      totalCcnt: 0,
      totalConvAmt: 0,
      totalPurchaseCcnt: 0,
      totalPurchaseConvAmt: 0,
    }
  );

  const avgCtr = summary.totalImp > 0 ? (summary.totalClk / summary.totalImp) * 100 : 0;
  const avgCpc = summary.totalClk > 0 ? Math.round(summary.totalCost / summary.totalClk) : 0;
  const purchaseRoas = summary.totalCost > 0 ? (summary.totalPurchaseConvAmt / summary.totalCost) * 100 : 0;
  const avgPurchaseCpa = summary.totalPurchaseCcnt > 0 ? Math.round(summary.totalCost / summary.totalPurchaseCcnt) : 0;

  // 캠페인 이름 검색 및 소팅 적용
  const filteredCampaigns = campaigns
    .filter(camp => camp.campaign_name.toLowerCase().includes(campaignSearchTerm.toLowerCase()))
    .sort((a, b) => {
      const sKey = (sortKey === 'adgroup_name' || sortKey === 'ad_name' ? 'campaign_name' : sortKey) as keyof CampaignStat;
      const aVal = a[sKey];
      const bVal = b[sKey];

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      } else {
        const aNum = (aVal as number) || 0;
        const bNum = (bVal as number) || 0;
        return sortOrder === 'asc' ? aNum - bNum : bNum - aNum;
      }
    });

  // 광고그룹 검색 및 소팅 적용
  const filteredAdgroups = adgroups
    .filter(adg => adg.adgroup_name.toLowerCase().includes(adgroupSearchTerm.toLowerCase()))
    .sort((a, b) => {
      const sKey = (sortKey === 'campaign_name' || sortKey === 'ad_name' ? 'adgroup_name' : sortKey) as keyof AdGroupStat;
      const aVal = a[sKey];
      const bVal = b[sKey];

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      } else {
        const aNum = (aVal as number) || 0;
        const bNum = (bVal as number) || 0;
        return sortOrder === 'asc' ? aNum - bNum : bNum - aNum;
      }
    });

  // 소재 검색 및 소팅 적용
  const filteredAds = ads
    .filter(adItem => adItem.ad_name.toLowerCase().includes(adSearchTerm.toLowerCase()))
    .sort((a, b) => {
      const sKey = (sortKey === 'campaign_name' || sortKey === 'adgroup_name' ? 'ad_name' : sortKey) as keyof AdStat;
      const aVal = a[sKey];
      const bVal = b[sKey];

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      } else {
        const aNum = (aVal as number) || 0;
        const bNum = (bVal as number) || 0;
        return sortOrder === 'asc' ? aNum - bNum : bNum - aNum;
      }
    });

  // 지능형 누락 수집률 계산 (V3.11)
  const gapPercentage = expectedDays > 0 ? Math.round((dbDistinctDatesCount / expectedDays) * 100) : 0;

  const formatNumber = (num: number) => new Intl.NumberFormat('ko-KR').format(num);

  // 광고그룹 테이블 소속 캠페인명 매핑 객체 빌드
  const campMapForView = new Map(campaigns.map(c => [c.campaign_id, c.campaign_name]));

  // 소재 테이블 소속 광고그룹명 매핑 객체 빌드
  const adgMapForView = new Map(adgroups.map(g => [g.adgroup_id, g.adgroup_name]));

  if (loadingUser) {
    return (
      <div className="fullscreen-loading">
        <div className="spinner" style={{ width: '40px', height: '40px' }}></div>
        <p className="loading-text" style={{ marginTop: '16px' }}>사용자 인증을 확인하는 중입니다...</p>
        <style jsx>{`
          .fullscreen-loading {
            height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background-color: #0b0f19;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      {/* 1. 사이드바 - 광고주 목록 */}
      <aside className="sidebar">
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
          <div className="logo-section" onClick={() => setSelectedAccountId("")} style={{ cursor: 'pointer' }}>
            <div className="logo-icon">N</div>
            <div className="logo-text">Premium Adboard</div>
          </div>

          {/* 🏠 V3.16.4: 통합 마케팅 성과 포털 홈 복귀 메뉴 */}
          <div 
            className={`account-item ${selectedAccountId === "" ? 'active' : ''}`}
            onClick={() => setSelectedAccountId("")}
            style={{
              margin: '0 8px 12px 8px',
              padding: '12px 16px',
              background: selectedAccountId === "" 
                ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.15) 0%, rgba(59, 130, 246, 0.15) 100%)' 
                : 'rgba(30, 41, 59, 0.25)',
              border: selectedAccountId === "" 
                ? '1px solid var(--primary-cyan)' 
                : '1px solid var(--panel-border)',
              borderRadius: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              transition: 'all 0.25s ease',
              boxShadow: selectedAccountId === "" ? '0 0 15px rgba(6, 182, 212, 0.2)' : 'none'
            }}
          >
            <span style={{ fontSize: '1.2rem', filter: selectedAccountId === "" ? 'drop-shadow(0 0 8px var(--primary-cyan))' : 'none' }}>🏠</span>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#f8fafc' }}>
                {currentUser?.role === 'ADMIN' ? '통합 마케팅 성과 포털' : '주요 광고주 통합 홈'}
              </span>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>전체 계정 모니터링 홈</span>
            </div>
          </div>

          {/* ADMIN 전용 유저 선택 필터 */}
          {currentUser?.role === 'ADMIN' && (
            <div className="admin-user-selector-container">
              <span className="menu-title" style={{ padding: 0 }}>👤 관리대상 유저 선택</span>
              <select
                value={selectedUserFilter}
                onChange={(e) => setSelectedUserFilter(e.target.value)}
                className="admin-select-input"
              >
                {usersList.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.user_name} ({u.login_id})
                  </option>
                ))}
              </select>
            </div>
          )}
          
          <h3 className="menu-title">광고주 계정 목록</h3>

          <div style={{ padding: '0 8px 16px 8px' }}>
            <input
              type="text"
              placeholder="🔍 광고주명 또는 고객 ID 검색..."
              className="search-input"
              style={{ width: '100%', fontSize: '0.8rem', padding: '8px 12px' }}
              value={accountSearchTerm}
              onChange={(e) => setAccountSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="accounts-list" style={{ flexGrow: 1, overflowY: 'auto' }}>
            {loadingAccounts ? (
              <div className="loading-view">
                <div className="spinner"></div>
                <div className="loading-text">광고주 로드 중...</div>
              </div>
            ) : filteredAccounts.length === 0 ? (
              <div className="empty-view">
                <div className="empty-text">검색 결과가 없습니다.</div>
              </div>
            ) : (
              filteredAccounts.map(acc => (
                <div
                  key={acc.customer_id}
                  className={`account-item ${selectedAccountId === acc.customer_id ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedAccountId(acc.customer_id);
                  }}
                  style={{ position: 'relative' }}
                >
                  <div style={{ paddingRight: '32px' }}>
                    <span className="account-name">{acc.ad_account_name}</span>
                    <span className="account-id">고객 ID: {acc.customer_id}</span>
                    <span className="account-sync-time">
                      최근 갱신: {acc.last_synced_at ? new Date(acc.last_synced_at).toLocaleString('ko-KR', { hour12: false }) : '미동기화'}
                    </span>
                  </div>
                  
                  {/* 별표 즐겨찾기 버튼 */}
                  <button
                    type="button"
                    onClick={(e) => handleToggleFavorite(e, acc.customer_id)}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '1.2rem',
                      padding: '4px',
                      color: acc.is_favorite ? 'var(--primary-rose)' : 'rgba(255, 255, 255, 0.25)',
                      textShadow: acc.is_favorite ? '0 0 8px rgba(244, 63, 94, 0.6)' : 'none',
                      transition: 'all 0.2s ease',
                      zIndex: 10
                    }}
                    title={acc.is_favorite ? "주요 계정 (매일 07:00 자동동기화)" : "주요 계정 지정하기"}
                  >
                    {acc.is_favorite ? '★' : '☆'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 하단 사용자 제어 영역 */}
        <div className="sidebar-footer-container">
          <div className="user-profile-widget">
            <span className="user-profile-name">👤 {currentUser?.user_name} 님</span>
            <span className="user-profile-role">{currentUser?.role === 'ADMIN' ? '최고 관리자' : '일반 사용자'}</span>
          </div>

          <div className="sidebar-action-buttons">
            <button className="btn-sidebar-secondary" onClick={() => handleSyncAccounts()} disabled={syncingAccounts}>
              {syncingAccounts ? '동기화 중...' : '🔄 광고주 목록 갱신'}
            </button>
            <button className="btn-sidebar-secondary" onClick={() => { 
              setPasswordError(''); 
              setPasswordSuccess(''); 
              setEditProfileName(currentUser?.user_name || '');
              setCurrentPassword('');
              setNewPassword('');
              setConfirmPassword('');
              setShowPasswordModal(true); 
            }}>
              ⚙️ 개인 정보 변경
            </button>
            <button className="btn-sidebar-danger" onClick={handleLogout}>
              🚪 로그아웃
            </button>
          </div>
        </div>
      </aside>

      {/* 2. 메인 패널 */}
      <main className="main-content">
        {/* 헤더 */}
        <header className="dashboard-header">
          <div className="title-group">
            <h1 className="dashboard-title" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              {activeTab === 'users' 
                ? '⚙️ 대시보드 사용자 계정 관리 (ADMIN)' 
                : activeAccount 
                  ? (
                    <>
                      <span>{activeAccount.ad_account_name} 성과분석</span>
                      {bizmoneyBalance !== null && (
                        <span style={{
                          fontSize: '0.8rem',
                          background: 'rgba(6, 182, 212, 0.15)',
                          border: '1px solid rgba(6, 182, 212, 0.4)',
                          color: 'var(--primary-cyan)',
                          padding: '4px 12px',
                          borderRadius: '20px',
                          fontWeight: 700,
                          boxShadow: '0 0 10px rgba(6, 182, 212, 0.2)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          marginLeft: '8px'
                        }}>
                          💰 비즈머니 잔액: {formatNumber(Math.round(bizmoneyBalance))}원
                        </span>
                      )}
                      {loadingBizmoney && (
                        <div className="spinner" style={{ width: '12px', height: '12px', borderTopColor: 'var(--primary-cyan)' }}></div>
                      )}
                    </>
                  ) 
                  : '네이버 검색광고 대시보드'}
            </h1>
            <p className="dashboard-subtitle" style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between', width: '100%' }}>
              <span>
                {activeTab === 'users'
                  ? '관리자 전용 사용자 계정 CRUD 및 개별 네이버 API Credentials 등록/수정 제어 패널'
                  : activeAccount 
                    ? `고객 ID: ${activeAccount.customer_id} (권한: ${activeAccount.account_role})` 
                    : '왼쪽 사이드바에서 광고주 계정을 선택하세요.'}
              </span>
              {selectedAccountId && (
                <button
                  onClick={() => setSelectedAccountId("")}
                  style={{
                    background: 'rgba(6, 182, 212, 0.1)',
                    border: '1px solid rgba(6, 182, 212, 0.3)',
                    color: 'var(--primary-cyan)',
                    padding: '4px 10px',
                    borderRadius: '8px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 0 8px rgba(6, 182, 212, 0.1)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(6, 182, 212, 0.2)';
                    e.currentTarget.style.borderColor = 'var(--primary-cyan)';
                    e.currentTarget.style.boxShadow = '0 0 12px rgba(6, 182, 212, 0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(6, 182, 212, 0.1)';
                    e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.3)';
                    e.currentTarget.style.boxShadow = '0 0 8px rgba(6, 182, 212, 0.1)';
                  }}
                >
                  ← 통합 포털 홈으로 복귀
                </button>
              )}
            </p>
          </div>
          
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {/* 기간 프리셋 선택 셀렉트 박스 */}
            {selectedAccountId && activeTab !== 'users' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>📅 조회 기간:</span>
                <select
                  value={datePreset}
                  onChange={(e) => setDatePreset(e.target.value as DatePreset)}
                  style={{
                    background: 'rgba(15, 23, 42, 0.6)',
                    border: '1px solid var(--panel-border)',
                    padding: '8px 12px',
                    borderRadius: '10px',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    outline: 'none',
                    cursor: 'pointer',
                    transition: 'var(--transition-smooth)'
                  }}
                >
                  <option value="yesterday">어제 (Yesterday)</option>
                  <option value="last7days">최근 7일 (Last 7 Days)</option>
                  <option value="last30days">최근 30일 (Last 30 Days)</option>
                  <option value="lastweek">지난 주 월~일 (Last Week)</option>
                  <option value="lastmonth">지난 달 1일~말일 (Last Month)</option>
                  <option value="custom">📅 직접 선택 (Custom Range)</option>
                </select>

                {datePreset === 'custom' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '4px' }}>
                    <input
                      type="date"
                      value={customSince}
                      onChange={(e) => setCustomSince(e.target.value)}
                      className="date-picker-input"
                    />
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>~</span>
                    <input
                      type="date"
                      value={customUntil}
                      onChange={(e) => setCustomUntil(e.target.value)}
                      className="date-picker-input"
                    />
                    <button
                      onClick={() => {
                        if (!customSince || !customUntil) {
                          alert('시작 날짜와 종료 날짜를 모두 입력해 주세요.');
                          return;
                        }
                        if (new Date(customSince) > new Date(customUntil)) {
                          alert('시작 날짜는 종료 날짜보다 이전이어야 합니다.');
                          return;
                        }
                        setAppliedCustomSince(customSince);
                        setAppliedCustomUntil(customUntil);
                      }}
                      className="btn-premium"
                      style={{
                        padding: '6px 14px',
                        fontSize: '0.8rem',
                        background: 'linear-gradient(135deg, var(--primary-cyan), var(--primary-blue))',
                        boxShadow: '0 0 10px rgba(6, 182, 212, 0.2)',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        color: '#ffffff',
                        fontWeight: 700,
                        whiteSpace: 'nowrap'
                      }}
                    >
                      🔍 조회
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 실시간 재동기화 버튼 */}
            {selectedAccountId && activeTab !== 'users' && (
              <button
                className="btn-premium"
                style={{
                  background: 'rgba(6, 182, 212, 0.1)',
                  border: '1px solid rgba(6, 182, 212, 0.4)',
                  boxShadow: 'none',
                  padding: '8px 16px',
                  fontSize: '0.8rem',
                  color: 'var(--primary-cyan)'
                }}
                onClick={() => {
                  const startDate = new Date(since);
                  const endDate = new Date(until);
                  const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
                  const expectedDaysVal = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

                  let popSince: string;

                  const sinceParts = since.split('-');
                  const sinceYear = parseInt(sinceParts[0], 10);
                  const sinceMonth = parseInt(sinceParts[1], 10);
                  const sinceDay = parseInt(sinceParts[2], 10);

                  if (sinceDay === 1) {
                    let prevYear = sinceYear;
                    let prevMonth = sinceMonth - 1;
                    if (prevMonth === 0) {
                      prevMonth = 12;
                      prevYear -= 1;
                    }
                    const pad = (n: number) => String(n).padStart(2, '0');
                    popSince = `${prevYear}-${pad(prevMonth)}-01`;
                  } else {
                    const popSinceDate = new Date(startDate.getTime() - expectedDaysVal * 24 * 60 * 60 * 1000);
                    const formatDate = (d: Date) => {
                      const year = d.getUTCFullYear();
                      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
                      const day = String(d.getUTCDate()).padStart(2, '0');
                      return `${year}-${month}-${day}`;
                    };
                    popSince = formatDate(popSinceDate);
                  }

                  handleSyncCampaigns(selectedAccountId, popSince, true);
                }}
                disabled={syncingCampaigns || loadingCampaigns || loadingAdgroups || loadingAds}
              >
                {syncingCampaigns ? (
                  <>
                    <div className="spinner" style={{ width: '12px', height: '12px', borderTopColor: 'var(--primary-cyan)' }}></div>
                    <span>실시간 동기화 중...</span>
                  </>
                ) : (
                  <span>⚡ 이 기간 실시간 API 동기화</span>
                )}
              </button>
            )}

            {activeTab !== 'users' && (
              <div className="date-badge">
                <span>조회 기준일자</span>
                <strong>{datePreset === 'yesterday' ? since : `${since} ~ ${until}`}</strong>
              </div>
            )}
          </div>
        </header>

        {activeTab === 'users' ? (
          /* ========================================================
             어드민 전용 사용자 계정 관리 탭 화면 (ADMIN 전용)
             ======================================================== */
          <section className="campaigns-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => { setActiveTab('briefing'); }}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--panel-border)',
                    color: 'var(--text-secondary)',
                    padding: '10px 20px',
                    borderRadius: '12px',
                    fontWeight: '600',
                    fontSize: '0.85rem',
                    cursor: 'pointer'
                  }}
                >
                  📂 AI 성과 브리핑으로 돌아가기
                </button>
              </div>

              <button
                onClick={openAddUserModal}
                className="btn-premium"
                style={{
                  background: 'linear-gradient(135deg, var(--primary-cyan), var(--primary-blue))',
                  padding: '10px 18px',
                  fontSize: '0.85rem'
                }}
              >
                ➕ 신규 사용자 계정 등록
              </button>
            </div>

            <div className="section-header">
              <h2 className="section-title">등록된 사용자 리스트 (총 {usersList.length}명)</h2>
            </div>

            {loadingUsersList ? (
              <div className="loading-view glass-panel">
                <div className="spinner"></div>
                <div className="loading-text">사용자 계정 불러오는 중...</div>
              </div>
            ) : usersList.length === 0 ? (
              <div className="empty-view glass-panel">
                <div className="empty-text">등록된 사용자가 없습니다.</div>
              </div>
            ) : (
              <div className="table-container">
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th>사용자 이름</th>
                      <th>로그인 ID</th>
                      <th>권한</th>
                      <th>네이버 매니저 ID</th>
                      <th>네이버 API Key (일부)</th>
                      <th>등록 일시</th>
                      <th style={{ textAlign: 'center' }}>작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usersList.map(u => (
                      <tr key={u.id}>
                        <td style={{ fontWeight: 600 }}>{u.user_name}</td>
                        <td style={{ color: 'var(--primary-cyan)', fontWeight: 600 }}>{u.login_id}</td>
                        <td>
                          <span className={`badge ${u.role === 'ADMIN' ? 'paused' : 'eligible'}`} style={{ textTransform: 'none' }}>
                            {u.role === 'ADMIN' ? '최고 관리자' : '일반 사용자'}
                          </span>
                        </td>
                        <td>{u.naver_customer_id}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {u.naver_api_key ? `${u.naver_api_key.substring(0, 10)}...` : '-'}
                        </td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {new Date(u.created_at).toLocaleString('ko-KR', { hour12: false })}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                            <button
                              className="btn-sidebar-secondary"
                              style={{ margin: 0, padding: '4px 10px', fontSize: '0.75rem' }}
                              onClick={() => openEditUserModal(u)}
                            >
                              ⚙️ 수정
                            </button>
                            <button
                              className="btn-sidebar-danger"
                              style={{ margin: 0, padding: '4px 10px', fontSize: '0.75rem' }}
                              onClick={() => handleDeleteUser(u)}
                              disabled={u.id === currentUser?.id}
                            >
                              🗑️ 삭제
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : selectedAccountId ? (
          /* ========================================================
             일반 성과분석 대시보드 화면
             ======================================================== */
          <>
            {/* 지능형 데이터 누락 감지 경고 배너 (V3.11) - 로딩 중이 아닐 때만 노출 */}
            {showDataGapBanner && !dismissDataGapBanner && !syncingCampaigns && !loadingCampaigns && !loadingAdgroups && !loadingAds && (
              <div className="data-gap-warning-banner glass-panel">
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexGrow: 1 }}>
                  <span className="banner-icon">⚠️</span>
                  <div className="banner-content" style={{ textAlign: 'left' }}>
                    <h4 className="banner-title">데이터 연동 상태 일부 누락 감지 (수집률 {gapPercentage}%)</h4>
                    <p className="banner-desc">
                      선택하신 {expectedDays}일 기간 중 <strong>{expectedDays - dbDistinctDatesCount}일간의 광고 데이터</strong>가 DB에 연동되지 않았습니다. 
                      실시간 API 동기화를 진행하여 정확한 광고 성과를 확인해 보세요!
                    </p>
                  </div>
                </div>
                <div className="banner-actions" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button 
                    onClick={handleSyncGapData}
                    className="btn-premium btn-banner-sync"
                  >
                    ⚡ 빠진 데이터 즉시 채우기
                  </button>
                  <button 
                    onClick={() => setDismissDataGapBanner(true)}
                    className="btn-banner-close"
                    
                    title="임시 닫기"
                  >
                    ×
                  </button>
                </div>
              </div>
            )}

            {/* 로딩/동기화 상태 */}
            {syncingCampaigns ? (
              <div className="loading-view glass-panel" style={{ background: 'rgba(6, 182, 212, 0.05)', borderColor: 'var(--primary-cyan)' }}>
                <div className="spinner" style={{ width: '40px', height: '40px', borderTopColor: 'var(--primary-cyan)' }}></div>
                <h3 style={{ color: 'var(--primary-cyan)', fontWeight: '600' }}>네이버 API로부터 기간 데이터 로드 중...</h3>
                <p className="loading-text" style={{ fontSize: '0.85rem' }}>선택하신 기간({since} ~ {until})의 데이터를 긁어와서 데이터베이스에 누적 적재 중입니다. 잠시만 기다려 주세요.</p>
              </div>
            ) : (loadingCampaigns || loadingAdgroups || loadingAds) ? (
              <div className="loading-view glass-panel">
                <div className="spinner"></div>
                <div className="loading-text">DB 데이터 조회 및 성과 집계 중...</div>
              </div>
            ) : (
              <>

                {/* 3. 종합 요약 지표 카드 */}
                <section className="stats-grid">
                  <div className="stat-card glass-panel">
                    <span className="stat-label">노출 / 클릭</span>
                    <span className="stat-value">{formatNumber(summary.totalImp)} / {formatNumber(summary.totalClk)}</span>
                    <div className="stat-detail">
                      <span>평균 클릭률: <strong>{avgCtr.toFixed(2)}%</strong></span>
                    </div>
                  </div>

                  <div className="stat-card glass-panel rose">
                    <span className="stat-label">소진 광고비</span>
                    <span className="stat-value">{formatNumber(Math.round(summary.totalCost))}원</span>
                    <div className="stat-detail">
                      <span>평균 CPC: <strong>{formatNumber(avgCpc)}원</strong></span>
                    </div>
                  </div>

                  <div className="stat-card glass-panel emerald">
                    <span className="stat-label">구매완료수</span>
                    <span className="stat-value">{formatNumber(summary.totalPurchaseCcnt)}건</span>
                    <div className="stat-detail">
                      <span>구매 전환당비용 (CPA): <strong>{formatNumber(avgPurchaseCpa)}원</strong></span>
                    </div>
                  </div>

                  <div className="stat-card glass-panel amber">
                    <span className="stat-label">구매전환매출</span>
                    <span className="stat-value">{formatNumber(summary.totalPurchaseConvAmt)}원</span>
                    <div className="stat-detail">
                      <span>구매 ROAS: <strong>{purchaseRoas.toFixed(1)}%</strong></span>
                    </div>
                  </div>
                </section>

                {/* 4. 캠페인 / 광고그룹 / 소재 성과 탭 & 테이블 섹션 */}
                <section className="campaigns-section">
                  {/* 탭 인터페이스 & 어드민 유저관리 탭 및 CSV 다운로드 버튼 헤더 영역 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px' }}>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {selectedAccountId && (
                        <button
                          onClick={() => { setActiveTab('briefing'); }}
                          style={{
                            background: activeTab === 'briefing' ? 'rgba(6, 182, 212, 0.15)' : 'transparent',
                            border: '1px solid',
                            borderColor: activeTab === 'briefing' ? 'var(--primary-cyan)' : 'var(--panel-border)',
                            color: activeTab === 'briefing' ? 'var(--text-primary)' : 'var(--text-secondary)',
                            padding: '10px 20px',
                            borderRadius: '12px',
                            fontWeight: '700',
                            fontSize: '0.85rem',
                            cursor: 'pointer',
                            boxShadow: activeTab === 'briefing' ? '0 0 10px rgba(6, 182, 212, 0.2)' : 'none',
                            transition: 'var(--transition-smooth)'
                          }}
                        >
                          ⚡ AI 성과 브리핑 & 이상 징후 (1차 브리핑)
                        </button>
                      )}
                      <button
                        onClick={() => { setActiveTab('campaign'); setSortKey('sales_amt'); }}
                        style={{
                          background: activeTab === 'campaign' ? 'rgba(6, 182, 212, 0.15)' : 'transparent',
                          border: '1px solid',
                          borderColor: activeTab === 'campaign' ? 'var(--primary-cyan)' : 'var(--panel-border)',
                          color: activeTab === 'campaign' ? 'var(--text-primary)' : 'var(--text-secondary)',
                          padding: '10px 20px',
                          borderRadius: '12px',
                          fontWeight: '600',
                          fontSize: '0.85rem',
                          cursor: 'pointer',
                          boxShadow: activeTab === 'campaign' ? '0 0 10px rgba(6, 182, 212, 0.2)' : 'none',
                          transition: 'var(--transition-smooth)'
                        }}
                      >
                        📂 캠페인 성과 현황
                      </button>
                      <button
                        onClick={() => { setActiveTab('adgroup'); setSortKey('sales_amt'); }}
                        style={{
                          background: activeTab === 'adgroup' ? 'rgba(6, 182, 212, 0.15)' : 'transparent',
                          border: '1px solid',
                          borderColor: activeTab === 'adgroup' ? 'var(--primary-cyan)' : 'var(--panel-border)',
                          color: activeTab === 'adgroup' ? 'var(--text-primary)' : 'var(--text-secondary)',
                          padding: '10px 20px',
                          borderRadius: '12px',
                          fontWeight: '600',
                          fontSize: '0.85rem',
                          cursor: 'pointer',
                          boxShadow: activeTab === 'adgroup' ? '0 0 10px rgba(6, 182, 212, 0.2)' : 'none',
                          transition: 'var(--transition-smooth)'
                        }}
                      >
                        👥 광고그룹 성과 현황
                      </button>
                      <button
                        onClick={() => { setActiveTab('ad'); setSortKey('sales_amt'); }}
                        style={{
                          background: activeTab === 'ad' ? 'rgba(6, 182, 212, 0.15)' : 'transparent',
                          border: '1px solid',
                          borderColor: activeTab === 'ad' ? 'var(--primary-cyan)' : 'var(--panel-border)',
                          color: activeTab === 'ad' ? 'var(--text-primary)' : 'var(--text-secondary)',
                          padding: '10px 20px',
                          borderRadius: '12px',
                          fontWeight: '600',
                          fontSize: '0.85rem',
                          cursor: 'pointer',
                          boxShadow: activeTab === 'ad' ? '0 0 10px rgba(6, 182, 212, 0.2)' : 'none',
                          transition: 'var(--transition-smooth)'
                        }}
                      >
                        🎨 소재 성과 현황
                      </button>

                      {/* ADMIN 전용 사용자 관리 탭 신설 */}
                      {currentUser?.role === 'ADMIN' && (
                        <button
                          onClick={() => { setActiveTab('users'); }}
                          style={{
                            background: 'transparent',
                            border: '1px solid rgba(244, 63, 94, 0.3)',
                            color: 'var(--primary-rose)',
                            padding: '10px 20px',
                            borderRadius: '12px',
                            fontWeight: '700',
                            fontSize: '0.85rem',
                            cursor: 'pointer',
                            transition: 'var(--transition-smooth)'
                          }}
                        >
                          ⚙️ 사용자 계정 관리
                        </button>
                      )}
                    </div>

                    {activeTab !== 'briefing' && (
                      <button
                        onClick={downloadCSV}
                        className="btn-premium"
                        style={{
                          background: 'linear-gradient(135deg, #10b981, #059669)',
                          boxShadow: '0 4px 15px rgba(16, 185, 129, 0.25)',
                          padding: '10px 18px',
                          fontSize: '0.85rem'
                        }}
                      >
                        📥 엑셀/CSV 다운로드 (구매완료 기준)
                      </button>
                    )}
                  </div>

                  {activeTab === 'briefing' ? (
                    /* ⚡ V3 신규: AI 1차 성과 브리핑 및 이상 징후 피드 화면 */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '20px' }}>
                      {/* V3.13 브리핑 안내 및 커스텀 설정 제어부 */}
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: 'rgba(15, 23, 42, 0.4)',
                        border: '1px solid var(--panel-border)',
                        borderRadius: '16px',
                        padding: '16px 24px',
                        gap: '16px',
                        flexWrap: 'wrap'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{ fontSize: '1.5rem' }}>🤖</span>
                          <div style={{ textAlign: 'left' }}>
                            <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: '#f8fafc' }}>
                              광고주별 AI 모니터링 엔진 임계값 필터링 가동 중
                            </h4>
                            <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                              현재 설정: 일일 [비용 {formatNumber(dailyMinCost)}원 | 노출 {formatNumber(dailyMinImp)}회 | 구매 {dailyMinPurchase}건] &amp; 
                              기간 [비용 {formatNumber(periodMinCost)}원 | 노출 {formatNumber(periodMinImp)}회 | 구매 {periodMinPurchase}건]
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={handleOpenSettingsModal}
                          className="btn-premium"
                          style={{
                            background: 'rgba(6, 182, 212, 0.15)',
                            border: '1px solid var(--primary-cyan)',
                            color: 'var(--primary-cyan)',
                            boxShadow: '0 0 10px rgba(6, 182, 212, 0.15)',
                            padding: '8px 16px',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            borderRadius: '10px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            transition: 'var(--transition-smooth)'
                          }}
                        >
                          ⚙️ 브리핑 임계값 설정
                        </button>
                      </div>
                      {/* 비즈머니 충전 경고 카드 */}
                      {bizmoneyBalance !== null && (bizmoneyBalance <= 50000 || (summary.totalCost > 0 && bizmoneyBalance < (summary.totalCost / (campaigns.length > 0 ? expectedDays : 1)) * 2)) && (
                        <div className="glass-panel" style={{
                          background: 'rgba(244, 63, 94, 0.08)',
                          border: '1px solid rgba(244, 63, 94, 0.3)',
                          borderRadius: '16px',
                          padding: '20px 24px',
                          display: 'flex',
                          gap: '16px',
                          alignItems: 'center'
                        }}>
                          <span style={{ fontSize: '2rem' }}>🔴</span>
                          <div>
                            <h3 style={{ color: '#f43f5e', fontWeight: 700, fontSize: '0.95rem', marginBottom: '4px' }}>비즈머니 잔고 소멸 임박 경보</h3>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: '1.5' }}>
                              현재 광고 계정의 비즈머니 잔액이 <strong>{formatNumber(Math.round(bizmoneyBalance))}원</strong> 남았습니다. 
                              현재 일 평균 소진 광고비(<strong>{formatNumber(Math.round(summary.totalCost / (campaigns.length > 0 ? expectedDays : 1)))}원</strong>) 기준으로 
                              약 <strong>{Math.max(0, Math.floor(bizmoneyBalance / (summary.totalCost / (campaigns.length > 0 ? expectedDays : 1) || 1)))}일 후</strong> 충전 잔액이 완전히 바닥나 네이버 광고 노출이 일제히 중단될 위기입니다. 지금 바로 비즈머니 충전을 진행해 주세요!
                            </p>
                          </div>
                        </div>
                      )}

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                        {/* 1. 최근 1일 이상 징후 분석 피드 */}
                        <div className="glass-panel" style={{ padding: '24px', borderRadius: '16px', border: '1px solid var(--panel-border)' }}>
                          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--primary-rose)', borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            ⚠️ 최근 1일 지표 이상 징후 감지 (Anomaly Feed)
                          </h3>
                          {anomalyFeed.length === 0 ? (
                            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                              분석 결과, 최근 1일 동안 일 평균 대비 비정상적으로 급증했거나 급감(소진 멈춤)한 지표 이상 징후가 감지되지 않았습니다. 광고가 안정적으로 소진 중입니다.
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                              {anomalyFeed.map((feed, i) => (
                                <div key={i} 
                                  className="insight-feed-card anomaly-card"
                                  onClick={() => setSelectedAnomaly(feed)}
                                  style={{
                                    background: feed.type.startsWith('SURGE') || feed.type.startsWith('SPIKE') || feed.type.startsWith('ZERO') ? 'rgba(217, 70, 239, 0.05)' : 'rgba(244, 63, 94, 0.05)',
                                    borderLeft: '4px solid',
                                    borderLeftColor: feed.type.startsWith('SURGE') || feed.type.startsWith('SPIKE') || feed.type.startsWith('ZERO') ? 'var(--primary-rose)' : '#f43f5e',
                                    padding: '14px 18px',
                                    borderRadius: '0 8px 8px 0',
                                    fontSize: '0.82rem',
                                    lineHeight: '1.5',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease'
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <span style={{ fontWeight: 700, color: feed.type.startsWith('SURGE') || feed.type.startsWith('SPIKE') || feed.type.startsWith('ZERO') ? 'var(--primary-rose)' : '#f43f5e' }}>
                                      {feed.type === 'SURGE_COST' ? '⚡ 광고비 폭증 감지' 
                                       : feed.type === 'DROP_COST' ? '⚠️ 광고 소진 급감'
                                       : feed.type === 'SURGE_PURCHASE' ? '⚡ 구매 전환수 폭발'
                                       : feed.type === 'DROP_PURCHASE' ? '⚠️ 구매 전환 급락'
                                       : feed.type === 'SURGE_ROAS' ? '⚡ 광고 수익률(ROAS) 폭증'
                                       : feed.type === 'DROP_ROAS' ? '⚠️ 광고 수익률(ROAS) 급락'
                                       : feed.type === 'SURGE_CTR' ? '⚡ 클릭률(CTR) 폭증'
                                       : feed.type === 'DROP_CTR' ? '⚠️ 클릭률(CTR) 급락'
                                       : feed.type === 'SURGE_CRTO' ? '⚡ 전환율(CRTO) 폭증'
                                       : feed.type === 'DROP_CRTO' ? '⚠️ 전환율(CRTO) 급락'
                                       : feed.type === 'SPIKE_TRAFFIC' ? '⚡ 노출수 폭증 감지' 
                                       : feed.type === 'ZERO_PURCHASE' ? '⚠️ 일일 구매 완료 0건 위기'
                                       : '⚠️ 지표 급감 (소진 위기)'}
                                    </span>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{feed.name}</span>
                                  </div>
                                  <div dangerouslySetInnerHTML={{ __html: feed.message }} style={{ color: 'var(--text-primary)', marginBottom: '4px' }}></div>
                                  <div style={{ fontSize: '0.7rem', color: 'var(--primary-cyan)', fontWeight: 600, textAlign: 'right' }}>🔍 대조 분석표 보기</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* 2. PoP 기간 성과 변동 피드 */}
                        <div className="glass-panel" style={{ padding: '24px', borderRadius: '16px', border: '1px solid var(--panel-border)' }}>
                          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--primary-emerald)', borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            📈 이전 기간 대비 성과 변동 피드 (PoP)
                          </h3>
                          {popFeed.length === 0 ? (
                            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                              ℹ️ 조회 범위 일수가 충분하지 않거나 이전 대비 눈에 띄는 트래픽 변동률(±25% 이상)이 발생한 캠페인이 없습니다.
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                              {popFeed.map((feed, i) => (
                                <div key={i} 
                                  className="insight-feed-card pop-card"
                                  onClick={() => setSelectedAnomaly(feed)}
                                  style={{
                                    background: feed.type.includes('GROWTH') ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)',
                                    borderLeft: '4px solid',
                                    borderLeftColor: feed.type.includes('GROWTH') ? 'var(--primary-emerald)' : '#ef4444',
                                    padding: '14px 18px',
                                    borderRadius: '0 8px 8px 0',
                                    fontSize: '0.82rem',
                                    lineHeight: '1.5',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease'
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <span style={{ fontWeight: 700, color: feed.type.includes('GROWTH') ? 'var(--primary-emerald)' : '#ef4444' }}>
                                      {feed.type === 'TRAFFIC_GROWTH' ? '🔺 트래픽 급상승' 
                                       : feed.type === 'TRAFFIC_DECLINE' ? '🔻 트래픽 급락 추세'
                                       : feed.type === 'COST_GROWTH' ? '🔺 광고비 급증'
                                       : feed.type === 'COST_DECLINE' ? '🔻 광고비 급감'
                                       : feed.type === 'PURCHASE_GROWTH' ? '🔺 구매 전환 폭증'
                                       : '🔻 구매 전환 급락'}
                                    </span>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{feed.name}</span>
                                  </div>
                                  <div dangerouslySetInnerHTML={{ __html: feed.message }} style={{ color: 'var(--text-primary)', marginBottom: '4px' }}></div>
                                  <div style={{ fontSize: '0.7rem', color: 'var(--primary-cyan)', fontWeight: 600, textAlign: 'right' }}>🔍 대조 분석표 보기</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* 세부 검색 및 타이틀 */}
                      <div className="section-header">
                        <h2 className="section-title">
                          {activeTab === 'campaign' ? '캠페인별 세부 성과' : activeTab === 'adgroup' ? '광고그룹별 세부 성과' : '소재별 세부 성과'} ({datePreset === 'yesterday' ? '어제 하루' : '해당 기간 합계'})
                        </h2>
                        <div className="search-filter-group">
                          <input
                            type="text"
                            placeholder={activeTab === 'campaign' ? "캠페인 이름 검색..." : activeTab === 'adgroup' ? "광고그룹 이름 검색..." : "소재 이름 검색..."}
                            className="search-input"
                            value={activeTab === 'campaign' ? campaignSearchTerm : activeTab === 'adgroup' ? adgroupSearchTerm : adSearchTerm}
                            onChange={(e) => {
                              if (activeTab === 'campaign') setCampaignSearchTerm(e.target.value);
                              else if (activeTab === 'adgroup') setAdgroupSearchTerm(e.target.value);
                              else setAdSearchTerm(e.target.value);
                            }}
                          />
                        </div>
                      </div>

                      {/* 탭 분기 테이블 렌더링 */}
                      {activeTab === 'campaign' ? (
                    filteredCampaigns.length === 0 ? (
                      <div className="empty-view glass-panel">
                        <div className="empty-icon">📂</div>
                        <div className="empty-text">해당 기간의 통계 데이터가 없거나 조건에 맞는 캠페인이 없습니다.</div>
                        <div className="account-sync-time">상단의 "⚡ 이 기간 실시간 API 동기화" 버튼을 클릭하여 새로운 데이터를 가져와 보세요.</div>
                      </div>
                    ) : (
                      <div className="table-container">
                        <table className="premium-table">
                          <thead>
                            <tr>
                              <th style={{ width: '40px', cursor: 'default' }}></th>
                              <th onClick={() => handleSort('campaign_name')}>캠페인명 {sortKey === 'campaign_name' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th>유형 / 상태</th>
                              <th onClick={() => handleSort('imp_cnt')}>노출수 {sortKey === 'imp_cnt' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('clk_cnt')}>클릭수 {sortKey === 'clk_cnt' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('ctr')}>CTR {sortKey === 'ctr' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('cpc')}>평균CPC {sortKey === 'cpc' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('sales_amt')}>광고비 {sortKey === 'sales_amt' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('ccnt')}>구매완료수 {sortKey === 'ccnt' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('conv_amt')}>구매완료매출액 {sortKey === 'conv_amt' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('ror')}>구매 ROAS {sortKey === 'ror' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredCampaigns.map(camp => {
                              const isExpanded = expandedCampaignIds.has(camp.campaign_id);
                              const subAdgroups = adgroups.filter(adg => adg.campaign_id === camp.campaign_id);

                              return (
                                <Fragment key={camp.campaign_id}>
                                  <tr style={{ borderBottom: isExpanded ? 'none' : '1px solid var(--panel-border)' }}>
                                    <td style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => toggleCampaignExpand(camp.campaign_id)}>
                                      <span style={{
                                        display: 'inline-block',
                                        transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                        transition: 'transform 0.2s ease',
                                        fontSize: '0.7rem',
                                        color: 'var(--primary-cyan)',
                                        fontWeight: 'bold'
                                      }}>
                                        ▶
                                      </span>
                                    </td>
                                    <td style={{ fontWeight: 600, maxWidth: '250px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {camp.campaign_name}
                                    </td>
                                    <td>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{camp.campaign_type}</span>
                                        <span className={`badge ${camp.campaign_status.toLowerCase()}`}>
                                          {camp.campaign_status === 'ELIGIBLE' ? '노출가능' : '노출제한'}
                                        </span>
                                      </div>
                                    </td>
                                    <td>{formatNumber(camp.imp_cnt)}</td>
                                    <td>{formatNumber(camp.clk_cnt)}</td>
                                    <td>{camp.ctr.toFixed(2)}%</td>
                                    <td>{formatNumber(Math.round(camp.cpc))}원</td>
                                    <td style={{ fontWeight: 600, color: 'var(--primary-rose)' }}>{formatNumber(Math.round(camp.sales_amt))}원</td>
                                    <td style={{ fontWeight: 600, color: 'var(--primary-emerald)' }}>{formatNumber(camp.purchase_ccnt)}건</td>
                                    <td style={{ fontWeight: 600, color: 'var(--primary-emerald)' }}>{formatNumber(Math.round(camp.purchase_conv_amt))}원</td>
                                    <td style={{ fontWeight: 600, color: 'var(--primary-amber)' }}>
                                      <span>{camp.purchase_ror.toFixed(0)}%</span>
                                    </td>
                                  </tr>
                                  
                                  {/* 아코디언 행 확장 레이아웃 (광고그룹 테이블) */}
                                  {isExpanded && (
                                    <tr>
                                      <td colSpan={11} style={{ padding: '0 24px 20px 24px', background: 'rgba(15, 23, 42, 0.2)' }}>
                                        <div style={{
                                          borderLeft: '2px solid var(--primary-cyan)',
                                          paddingLeft: '16px',
                                          marginTop: '4px',
                                          background: 'rgba(30, 41, 59, 0.2)',
                                          borderRadius: '0 12px 12px 0',
                                          border: '1px solid rgba(255,255,255,0.03)',
                                          borderLeftWidth: '2px',
                                          borderLeftColor: 'var(--primary-cyan)',
                                          overflow: 'hidden'
                                        }}>
                                          <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--primary-cyan)' }}>
                                              📋 소속 광고그룹 세부 성과 (총 {subAdgroups.length}개)
                                            </span>
                                          </div>
                                          {subAdgroups.length === 0 ? (
                                            <div style={{ padding: '20px', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                              소속된 광고그룹 정보가 없거나 통계가 존재하지 않습니다.
                                            </div>
                                          ) : (
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                              <thead>
                                                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                  <th style={{ width: '30px' }}></th>
                                                  <th style={{ padding: '10px', color: 'var(--text-secondary)', textAlign: 'left', fontWeight: '600' }}>광고그룹명</th>
                                                  <th style={{ padding: '10px', color: 'var(--text-secondary)', textAlign: 'left', fontWeight: '600' }}>상태</th>
                                                  <th style={{ padding: '10px', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: '600' }}>기본입찰가</th>
                                                  <th style={{ padding: '10px', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: '600' }}>노출수</th>
                                                  <th style={{ padding: '10px', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: '600' }}>클릭수</th>
                                                  <th style={{ padding: '10px', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: '600' }}>CTR</th>
                                                  <th style={{ padding: '10px', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: '600' }}>평균CPC</th>
                                                  <th style={{ padding: '10px', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: '600' }}>광고비</th>
                                                  <th style={{ padding: '10px', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: '600' }}>구매완료수</th>
                                                  <th style={{ padding: '10px', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: '600' }}>구매매출</th>
                                                  <th style={{ padding: '10px', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: '600' }}>구매ROAS</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {subAdgroups.map(subg => {
                                                  const isAdgExpanded = expandedAdgroupIds.has(subg.adgroup_id);
                                                  const subAds = ads.filter(a => a.adgroup_id === subg.adgroup_id);

                                                  return (
                                                    <Fragment key={subg.adgroup_id}>
                                                      <tr style={{ borderBottom: isAdgExpanded ? 'none' : '1px solid rgba(255,255,255,0.03)' }}>
                                                        <td style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => toggleAdgroupExpand(subg.adgroup_id)}>
                                                          <span style={{
                                                            display: 'inline-block',
                                                            transform: isAdgExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                                            transition: 'transform 0.2s ease',
                                                            fontSize: '0.65rem',
                                                            color: 'var(--primary-cyan)',
                                                            fontWeight: 'bold'
                                                          }}>
                                                            ▶
                                                          </span>
                                                        </td>
                                                        <td style={{ padding: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{subg.adgroup_name}</td>
                                                        <td style={{ padding: '10px' }}>
                                                          <span className={`badge ${subg.adgroup_status.toLowerCase()}`} style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                                                            {subg.adgroup_status === 'ELIGIBLE' ? '노출가능' : '노출제한'}
                                                          </span>
                                                        </td>
                                                        <td style={{ padding: '10px', textAlign: 'right' }}>{formatNumber(subg.bid_amt || 0)}원</td>
                                                        <td style={{ padding: '10px', textAlign: 'right' }}>{formatNumber(subg.imp_cnt)}</td>
                                                        <td style={{ padding: '10px', textAlign: 'right' }}>{formatNumber(subg.clk_cnt)}</td>
                                                        <td style={{ padding: '10px', textAlign: 'right' }}>{subg.ctr.toFixed(2)}%</td>
                                                        <td style={{ padding: '10px', textAlign: 'right' }}>{formatNumber(Math.round(subg.cpc))}원</td>
                                                        <td style={{ padding: '10px', textAlign: 'right', color: 'var(--primary-rose)', fontWeight: 600 }}>{formatNumber(subg.sales_amt)}원</td>
                                                        <td style={{ padding: '10px', textAlign: 'right', color: 'var(--primary-emerald)', fontWeight: 600 }}>{formatNumber(subg.purchase_ccnt)}건</td>
                                                        <td style={{ padding: '10px', textAlign: 'right', color: 'var(--primary-emerald)', fontWeight: 600 }}>{formatNumber(Math.round(subg.purchase_conv_amt))}원</td>
                                                        <td style={{ padding: '10px', textAlign: 'right', color: 'var(--primary-amber)', fontWeight: 600 }}>{subg.purchase_ror.toFixed(0)}%</td>
                                                      </tr>

                                                      {/* 아코디언 3단계 행 확장 레이아웃 (소재 테이블) */}
                                                      {isAdgExpanded && (
                                                        <tr>
                                                          <td colSpan={12} style={{ padding: '0 16px 12px 16px', background: 'rgba(15, 23, 42, 0.3)' }}>
                                                            <div style={{
                                                              borderLeft: '2px dashed var(--primary-cyan)',
                                                              paddingLeft: '12px',
                                                              marginTop: '2px',
                                                              background: 'rgba(30, 41, 59, 0.3)',
                                                              borderRadius: '0 8px 8px 0',
                                                              border: '1px solid rgba(255,255,255,0.02)',
                                                              borderLeftWidth: '2px',
                                                              borderLeftColor: 'var(--primary-cyan)',
                                                              overflow: 'hidden'
                                                            }}>
                                                              <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                                                                  🎨 소속 소재 세부 성과 (총 {subAds.length}개)
                                                                </span>
                                                              </div>
                                                              {subAds.length === 0 ? (
                                                                <div style={{ padding: '12px', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                                  소속된 소재 정보가 없거나 통계가 존재하지 않습니다.
                                                                </div>
                                                              ) : (
                                                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                                                                  <thead>
                                                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                                                      <th style={{ padding: '6px 8px', color: 'var(--text-secondary)', textAlign: 'left', fontWeight: '600' }}>소재명</th>
                                                                      <th style={{ padding: '6px 8px', color: 'var(--text-secondary)', textAlign: 'left', fontWeight: '600' }}>유형</th>
                                                                      <th style={{ padding: '6px 8px', color: 'var(--text-secondary)', textAlign: 'left', fontWeight: '600' }}>상태 / 검수</th>
                                                                      <th style={{ padding: '6px 8px', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: '600' }}>노출수</th>
                                                                      <th style={{ padding: '6px 8px', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: '600' }}>클릭수</th>
                                                                      <th style={{ padding: '6px 8px', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: '600' }}>CTR</th>
                                                                      <th style={{ padding: '6px 8px', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: '600' }}>평균CPC</th>
                                                                      <th style={{ padding: '6px 8px', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: '600' }}>광고비</th>
                                                                      <th style={{ padding: '6px 8px', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: '600' }}>구매완료수</th>
                                                                      <th style={{ padding: '6px 8px', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: '600' }}>구매매출</th>
                                                                      <th style={{ padding: '6px 8px', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: '600' }}>구매ROAS</th>
                                                                    </tr>
                                                                  </thead>
                                                                  <tbody>
                                                                    {subAds.map(suba => (
                                                                      <tr key={suba.ad_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                                                                        <td style={{ padding: '6px 8px', fontWeight: 600, color: 'rgba(255,255,255,0.8)', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={suba.ad_name}>
                                                                          {suba.ad_name}
                                                                        </td>
                                                                        <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{suba.ad_type}</td>
                                                                        <td style={{ padding: '6px 8px' }}>
                                                                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                                                              {renderStatusBadge(suba.ad_status)}
                                                                              {renderInspectBadge(suba.inspect_status)}
                                                                          </div>
                                                                        </td>
                                                                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatNumber(suba.imp_cnt)}</td>
                                                                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatNumber(suba.clk_cnt)}</td>
                                                                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{suba.ctr.toFixed(2)}%</td>
                                                                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatNumber(Math.round(suba.cpc))}원</td>
                                                                        <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--primary-rose)', fontWeight: 600 }}>{formatNumber(suba.sales_amt)}원</td>
                                                                        <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--primary-emerald)', fontWeight: 600 }}>{formatNumber(suba.purchase_ccnt)}건</td>
                                                                        <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--primary-emerald)', fontWeight: 600 }}>{formatNumber(Math.round(suba.purchase_conv_amt))}원</td>
                                                                        <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--primary-amber)', fontWeight: 600 }}>{suba.purchase_ror.toFixed(0)}%</td>
                                                                      </tr>
                                                                    ))}
                                                                  </tbody>
                                                                </table>
                                                              )}
                                                            </div>
                                                          </td>
                                                        </tr>
                                                      )}
                                                    </Fragment>
                                                  );
                                                })}
                                              </tbody>
                                            </table>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : activeTab === 'adgroup' ? (
                    /* 광고그룹 단독 성과 탭 화면 */
                    filteredAdgroups.length === 0 ? (
                      <div className="empty-view glass-panel">
                        <div className="empty-icon">👥</div>
                        <div className="empty-text">해당 기간의 통계 데이터가 없거나 조건에 맞는 광고그룹이 없습니다.</div>
                        <div className="account-sync-time">상단의 "⚡ 이 기간 실시간 API 동기화" 버튼을 클릭하여 새로운 데이터를 가져와 보세요.</div>
                      </div>
                    ) : (
                      <div className="table-container">
                        <table className="premium-table">
                          <thead>
                            <tr>
                              <th onClick={() => handleSort('adgroup_name')}>광고그룹명 {sortKey === 'adgroup_name' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th>소속 캠페인명</th>
                              <th>유형 / 상태</th>
                              <th>기본입찰가</th>
                              <th onClick={() => handleSort('imp_cnt')}>노출수 {sortKey === 'imp_cnt' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('clk_cnt')}>클릭수 {sortKey === 'clk_cnt' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('ctr')}>CTR {sortKey === 'ctr' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('cpc')}>평균CPC {sortKey === 'cpc' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('sales_amt')}>광고비 {sortKey === 'sales_amt' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('ccnt')}>구매완료수 {sortKey === 'ccnt' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('conv_amt')}>구매완료매출액 {sortKey === 'conv_amt' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('ror')}>구매 ROAS {sortKey === 'ror' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredAdgroups.map(adg => {
                              const campName = campMapForView.get(adg.campaign_id) || campaignMasterNames.get(adg.campaign_id) || '알 수 없는 캠페인';

                              return (
                                <tr key={adg.adgroup_id}>
                                  <td style={{ fontWeight: 600, maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {adg.adgroup_name}
                                  </td>
                                  <td style={{ color: 'var(--text-secondary)', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {campName}
                                  </td>
                                  <td>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{adg.adgroup_type}</span>
                                      <span className={`badge ${adg.adgroup_status.toLowerCase()}`}>
                                        {adg.adgroup_status === 'ELIGIBLE' ? '노출가능' : '노출제한'}
                                      </span>
                                    </div>
                                  </td>
                                  <td>{formatNumber(adg.bid_amt || 0)}원</td>
                                  <td>{formatNumber(adg.imp_cnt)}</td>
                                  <td>{formatNumber(adg.clk_cnt)}</td>
                                  <td>{adg.ctr.toFixed(2)}%</td>
                                  <td>{formatNumber(Math.round(adg.cpc))}원</td>
                                  <td style={{ fontWeight: 600, color: 'var(--primary-rose)' }}>{formatNumber(adg.sales_amt)}원</td>
                                  <td style={{ fontWeight: 600, color: 'var(--primary-emerald)' }}>{formatNumber(adg.purchase_ccnt)}건</td>
                                  <td style={{ fontWeight: 600, color: 'var(--primary-emerald)' }}>{formatNumber(Math.round(adg.purchase_conv_amt))}원</td>
                                  <td style={{ fontWeight: 600, color: 'var(--primary-amber)' }}>
                                    <span>{adg.purchase_ror.toFixed(0)}%</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : (
                    /* 소재 단독 성과 탭 화면 */
                    filteredAds.length === 0 ? (
                      <div className="empty-view glass-panel">
                        <div className="empty-icon">🎨</div>
                        <div className="empty-text">해당 기간의 통계 데이터가 없거나 조건에 맞는 소재가 없습니다.</div>
                        <div className="account-sync-time">상단의 "⚡ 이 기간 실시간 API 동기화" 버튼을 클릭하여 새로운 데이터를 가져와 보세요.</div>
                      </div>
                    ) : (
                      <div className="table-container">
                        <table className="premium-table">
                          <thead>
                            <tr>
                              <th onClick={() => handleSort('ad_name')}>소재명 {sortKey === 'ad_name' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th>소속 광고그룹</th>
                              <th>소속 캠페인</th>
                              <th>유형 / 상태 / 검수</th>
                              <th onClick={() => handleSort('imp_cnt')}>노출수 {sortKey === 'imp_cnt' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('clk_cnt')}>클릭수 {sortKey === 'clk_cnt' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('ctr')}>CTR {sortKey === 'ctr' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('cpc')}>평균CPC {sortKey === 'cpc' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('sales_amt')}>광고비 {sortKey === 'sales_amt' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('ccnt')}>구매완료수 {sortKey === 'ccnt' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('conv_amt')}>구매완료매출액 {sortKey === 'conv_amt' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                              <th onClick={() => handleSort('ror')}>구매 ROAS {sortKey === 'ror' && (sortOrder === 'asc' ? '▲' : '▼')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredAds.map(adItem => {
                              const adgName = adgMapForView.get(adItem.adgroup_id) || adgroupMasterNames.get(adItem.adgroup_id) || '알 수 없는 광고그룹';
                              const campName = campMapForView.get(adItem.campaign_id) || campaignMasterNames.get(adItem.campaign_id) || '알 수 없는 캠페인';

                              return (
                                <tr key={adItem.ad_id}>
                                  <td style={{ fontWeight: 600, maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={adItem.ad_name}>
                                    {adItem.ad_name}
                                  </td>
                                  <td style={{ color: 'var(--text-secondary)', maxWidth: '150px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {adgName}
                                  </td>
                                  <td style={{ color: 'var(--text-secondary)', maxWidth: '150px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {campName}
                                  </td>
                                  <td>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{adItem.ad_type}</span>
                                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                          {renderStatusBadge(adItem.ad_status)}
                                          {renderInspectBadge(adItem.inspect_status)}
                                      </div>
                                    </div>
                                  </td>
                                  <td>{formatNumber(adItem.imp_cnt)}</td>
                                  <td>{formatNumber(adItem.clk_cnt)}</td>
                                  <td>{adItem.ctr.toFixed(2)}%</td>
                                  <td>{formatNumber(Math.round(adItem.cpc))}원</td>
                                  <td style={{ fontWeight: 600, color: 'var(--primary-rose)' }}>{formatNumber(adItem.sales_amt)}원</td>
                                  <td style={{ fontWeight: 600, color: 'var(--primary-emerald)' }}>{formatNumber(adItem.purchase_ccnt)}건</td>
                                  <td style={{ fontWeight: 600, color: 'var(--primary-emerald)' }}>{formatNumber(Math.round(adItem.purchase_conv_amt))}원</td>
                                  <td style={{ fontWeight: 600, color: 'var(--primary-amber)' }}>
                                    <span>{adItem.purchase_ror.toFixed(0)}%</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                  )}
                  </>
                  )}
                </section>
              </>
            )}
          </>
        ) : (
          /* ========================================================
             V3.16.0: [🏠 통합 마케팅 성과 포털] 화면 (selectedAccountId === "" 일 때)
             ======================================================== */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%' }}>
            
            <div className="portal-hero-section" style={{
              background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.6) 100%)',
              border: '1px solid var(--panel-border)',
              borderRadius: '20px',
              padding: '24px 32px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)'
            }}>
              <div style={{ textAlign: 'left' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--primary-cyan)', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
                  Unified Marketing Control Centre
                </span>
                <h2 style={{ fontSize: '1.6rem', fontWeight: 900, color: '#ffffff', margin: '4px 0 0 0', textShadow: '0 0 20px rgba(255,255,255,0.05)' }}>
                  {currentUser?.role === 'ADMIN' ? '📊 ADMIN 통합 마케팅 성과 포털' : '⭐️ 주요 광고주 통합 성과 보드'}
                </h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  {currentUser?.role === 'ADMIN' 
                    ? '최근 30일 무소진 휴면 계정을 제외한 실시간 활성 광고주들의 어제 하루 통합 지표를 관제합니다.' 
                    : '즐겨찾기(★) 등록된 광고주 계정의 성과를 실시간 관제합니다. (최대 3개)'}
                </p>
              </div>
              <button
                onClick={() => fetchPortalData()}
                className="btn-premium"
                style={{
                  background: 'rgba(6, 182, 212, 0.15)',
                  border: '1px solid var(--primary-cyan)',
                  color: 'var(--primary-cyan)',
                  padding: '10px 20px',
                  borderRadius: '12px',
                  fontWeight: 700,
                  fontSize: '0.85rem'
                }}
                disabled={portalLoading}
              >
                {portalLoading ? '🔄 포털 갱신 중...' : '🔄 실시간 관제 데이터 갱신'}
              </button>
            </div>

            {portalLoading ? (
              <div className="loading-view glass-panel" style={{ height: '300px' }}>
                <div className="spinner"></div>
                <div className="loading-text">통합 관제 포털 데이터를 산출하는 중...</div>
              </div>
            ) : accounts.length === 0 ? (
              <div className="empty-view glass-panel" style={{ height: '300px' }}>
                <div className="empty-icon">👈</div>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 600 }}>연동된 광고주 계정이 없습니다.</h2>
                <p className="empty-text">사이드바 하단의 '🔄 광고주 목록 갱신' 버튼을 눌러 계정을 등록하세요.</p>
              </div>
            ) : (
              <>
                {/* 1. 🚨 긴급 점검 필요 광고주 경보 보드 (Urgent Anomaly Alerts - USER는 본인의 즐겨찾기 기준 노출) */}
                {urgentAlerts.length > 0 && (
                  <div className="glass-panel urgent-portal-alert-board" style={{
                    background: 'rgba(244, 63, 94, 0.04)',
                    border: '1px solid rgba(244, 63, 94, 0.3)',
                    borderRadius: '20px',
                    padding: '24px',
                    boxShadow: '0 8px 32px rgba(244, 63, 94, 0.05)',
                    animation: 'alertsPulse 3s infinite alternate'
                  }}>
                    <h3 className="urgent-pulse-title" style={{
                      margin: '0 0 16px 0',
                      fontSize: '1rem',
                      fontWeight: 800,
                      color: 'var(--primary-rose)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <span className="urgent-pulse-dot" />
                      🚨 긴급 점검 필요 광고주 경보 보드
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                      {urgentAlerts.map((alertItem, idx) => (
                        <div
                          key={idx}
                          onClick={() => setSelectedAccountId(alertItem.customer_id)}
                          className="urgent-alert-card"
                          style={{
                            background: 'rgba(15, 23, 42, 0.6)',
                            border: '1px solid rgba(244, 63, 94, 0.15)',
                            borderRadius: '12px',
                            padding: '16px 20px',
                            cursor: 'pointer',
                            transition: 'all 0.25s ease',
                            textAlign: 'left'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <span style={{ fontWeight: 800, color: '#f8fafc', fontSize: '0.85rem' }}>{alertItem.ad_account_name}</span>
                            <span style={{
                              fontSize: '0.65rem',
                              fontWeight: 900,
                              color: '#ffffff',
                              background: '#ef4444',
                              padding: '2px 8px',
                              borderRadius: '20px',
                              textShadow: '0 0 10px rgba(255,255,255,0.4)',
                              boxShadow: '0 0 8px rgba(239, 68, 68, 0.4)'
                            }}>
                              {alertItem.type === 'ZERO' ? 'OFF/소진중단' : alertItem.type === 'SURGE' ? '폭증' : '폭락'}
                            </span>
                          </div>
                          <p style={{ margin: 0, fontSize: '0.78rem', color: '#cbd5e1', lineHeight: '1.5' }} dangerouslySetInnerHTML={{ __html: alertItem.message }}></p>
                          <div style={{ textAlign: 'right', fontSize: '0.7rem', color: 'var(--primary-rose)', fontWeight: 800, marginTop: '8px' }}>
                            🎯 즉시 정밀 튜닝 대시보드로 이동하기 →
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. 어제 하루 통합 메가 스코어보드 (오직 ADMIN일 때만 보안 노출! 구매완료수/ROAS 전체합산 제외) */}
                {currentUser?.role === 'ADMIN' && (
                  <section className="stats-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
                    <div 
                      className="stat-card glass-panel" 
                      onClick={() => setShowActiveAdvertisersModal(true)}
                      style={{
                        background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.05) 0%, rgba(15, 23, 42, 0.4) 100%)',
                        border: '1px solid rgba(6, 182, 212, 0.2)',
                        boxShadow: '0 4px 20px rgba(6, 182, 212, 0.05)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.borderColor = 'var(--primary-cyan)';
                        e.currentTarget.style.boxShadow = '0 6px 24px rgba(6, 182, 212, 0.15)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'none';
                        e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.2)';
                        e.currentTarget.style.boxShadow = '0 4px 20px rgba(6, 182, 212, 0.05)';
                      }}
                    >
                      <span className="stat-label" style={{ color: 'var(--primary-cyan)' }}>🔗 전체 활성 광고주 수</span>
                      <span className="stat-value" style={{ color: '#ffffff' }}>{activeAdvertisers.length}개사</span>
                      <div className="stat-detail">
                        <span>비활성/휴면 계정 제외 (클릭 시 목록 팝업)</span>
                      </div>
                    </div>

                    <div className="stat-card glass-panel rose" style={{
                      background: 'linear-gradient(135deg, rgba(244, 63, 94, 0.05) 0%, rgba(15, 23, 42, 0.4) 100%)',
                      border: '1px solid rgba(244, 63, 94, 0.2)',
                      boxShadow: '0 4px 20px rgba(244, 63, 94, 0.05)'
                    }}>
                      <span className="stat-label">💸 어제 총 소진 광고비</span>
                      <span className="stat-value">{formatNumber(Math.round(megaSummary.totalCost))}원</span>
                      <div className="stat-detail">
                        <span>평균 CPC: <strong>{formatNumber(megaSummary.avgCpc)}원</strong></span>
                      </div>
                    </div>
                  </section>
                )}

                {/* 3. 소진비 정렬 Active 그리드 카드 보드 */}
                <div style={{ marginTop: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px', marginBottom: '20px' }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#f8fafc', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {currentUser?.role === 'ADMIN' 
                        ? '📋 실시간 활성 광고주별 성과 관제 보드 (소진액 순 정렬)' 
                        : '⭐️ 나의 주요 광고주 성과 현황 (소진액 순 정렬)'}
                    </h3>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {currentUser?.role === 'ADMIN' 
                        ? `총 ${activeAdvertisers.length}개 활성 업체 노출` 
                        : `즐겨찾기 주요 ${activeAdvertisers.length}개 노출 (최대 3개)`}
                    </span>
                  </div>

                  {currentUser?.role !== 'ADMIN' && activeAdvertisers.length === 0 ? (
                    /* ⭐️ 일반 유저(USER) 중 즐겨찾기가 한 개도 등록되지 않은 경우 다크 글래스모피즘 가이드 빈 뷰 표출 */
                    <div className="empty-view glass-panel" style={{
                      height: '280px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: '16px',
                      background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.6) 100%)',
                      border: '1px solid var(--panel-border)',
                      borderRadius: '20px',
                      padding: '40px',
                      textAlign: 'center',
                      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)'
                    }}>
                      <div className="empty-icon" style={{ fontSize: '3rem', animation: 'pulse 2s infinite' }}>⭐️</div>
                      <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>등록된 주요 관제 광고주가 없습니다</h3>
                      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '400px', lineHeight: '1.6' }}>
                        왼쪽 사이드바의 광고주 목록에서 **별표(☆)를 클릭**하여 주요 관제 광고주로 등록해 보세요! 소진액 순 상위 **최대 3개**까지 여기에 실시간 성과 카드가 표출됩니다.
                      </p>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                      {activeAdvertisers.map((acc, idx) => (
                        <div
                          key={acc.customer_id}
                          onClick={() => setSelectedAccountId(acc.customer_id)}
                          className="active-advertiser-portal-card"
                          style={{
                            background: 'rgba(30, 41, 59, 0.25)',
                            border: '1px solid var(--panel-border)',
                            borderRadius: '16px',
                            padding: '20px',
                            cursor: 'pointer',
                            transition: 'all 0.25s ease',
                            position: 'relative',
                            overflow: 'hidden',
                            textAlign: 'left'
                          }}
                        >
                          <div style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            height: '4px',
                            width: '100%',
                            background: idx === 0 ? 'linear-gradient(90deg, #f59e0b, #eab308)' : 'linear-gradient(90deg, var(--primary-cyan), var(--primary-blue))'
                          }} />
                          
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                            <div>
                              <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: '#f8fafc' }}>
                                {idx === 0 && '👑 '}{acc.ad_account_name}
                              </h4>
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>ID: {acc.customer_id}</span>
                            </div>
                            <span style={{
                              fontSize: '0.62rem',
                              fontWeight: 800,
                              color: 'var(--primary-cyan)',
                              background: 'rgba(6, 182, 212, 0.1)',
                              border: '1px solid rgba(6, 182, 212, 0.3)',
                              padding: '2px 8px',
                              borderRadius: '12px'
                            }}>
                              RANK {idx + 1}
                            </span>
                          </div>

                          {/* 수치 요약 */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                              <span style={{ color: 'var(--text-secondary)' }}>어제 소진 광고비:</span>
                              <strong style={{ color: 'var(--primary-rose)' }}>{formatNumber(Math.round(acc.yesterdayCost))}원</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                              <span style={{ color: 'var(--text-secondary)' }}>어제 구매완료수:</span>
                              <strong style={{ color: 'var(--primary-emerald)' }}>{formatNumber(acc.yesterdayPurchase)}건</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                              <span style={{ color: 'var(--text-secondary)' }}>어제 전환 매출액:</span>
                              <strong style={{ color: '#ffffff' }}>{formatNumber(Math.round(acc.yesterdaySales))}원</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                              <span style={{ color: 'var(--text-secondary)' }}>어제 구매 ROAS:</span>
                              <strong style={{ color: 'var(--primary-amber)' }}>{acc.avgRoas.toFixed(1)}%</strong>
                            </div>
                          </div>

                          <div style={{
                            marginTop: '16px',
                            paddingTop: '8px',
                            borderTop: '1px dashed rgba(255,255,255,0.05)',
                            fontSize: '0.7rem',
                            color: 'var(--text-secondary)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}>
                            <span>최근 30일 소진비: {formatNumber(Math.round(acc.total30Cost))}원</span>
                            <span style={{ color: 'var(--primary-cyan)', fontWeight: 800 }}>대시보드 진입 →</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {/* ========================================================
         상세 대조 분석 팝업 모달
         ======================================================== */}
      {selectedAnomaly && (
        <div className="modal-overlay" onClick={() => setSelectedAnomaly(null)}>
          <div className="modal-card glass-panel" style={{ maxWidth: '600px', width: '95%', padding: '28px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  color: 'var(--primary-cyan)',
                  letterSpacing: '1px'
                }}>
                  {selectedAnomaly.periodInfo || '지표 상세 대조 분석'}
                </span>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                  📢 {selectedAnomaly.name} 상세 성과 대조표
                </h3>
              </div>
              <button className="btn-modal-close" onClick={() => setSelectedAnomaly(null)}>×</button>
            </div>

            <div style={{ marginTop: '20px' }}>
              <div style={{
                background: 'rgba(15, 23, 42, 0.4)',
                border: '1px solid var(--panel-border)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '20px',
                fontSize: '0.82rem',
                lineHeight: '1.6',
                color: 'var(--text-secondary)'
              }}>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>💡 AI 브리핑 분석 내용:</strong>
                <span dangerouslySetInnerHTML={{ __html: selectedAnomaly.message }}></span>
              </div>

              <div className="table-container" style={{ maxHeight: 'none', overflow: 'visible', background: 'transparent' }}>
                <table className="premium-table" style={{ width: '100%', fontSize: '0.85rem' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '10px' }}>성과 지표</th>
                      <th style={{ textAlign: 'right', padding: '10px' }}>이전 기준 값</th>
                      <th style={{ textAlign: 'right', padding: '10px' }}>현재 변경 값</th>
                      <th style={{ textAlign: 'right', padding: '10px' }}>변동률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedAnomaly.details && selectedAnomaly.details.map((detail: any, idx: number) => {
                      const prevVal = detail.prev || 0;
                      const curVal = detail.current || 0;
                      
                      // 화면에 보여줄 정수 반올림 값 계산
                      const dispPrev = Math.round(prevVal);
                      const dispCur = Math.round(curVal);
                      
                      let diffPercent = 0;
                      if (dispPrev > 0) {
                        diffPercent = ((dispCur - dispPrev) / dispPrev) * 100;
                      } else if (dispPrev === 0 && dispCur > 0) {
                        diffPercent = 100;
                      }

                      const isPositive = diffPercent > 0;
                      const isZero = diffPercent === 0;

                      // 소수점 완전히 버려 정수로 포맷
                      const formattedPrev = detail.unit === '원' || detail.unit === '회' 
                        ? formatNumber(dispPrev) 
                        : dispPrev;
                      
                      const formattedCur = detail.unit === '원' || detail.unit === '회' 
                        ? formatNumber(dispCur) 
                        : dispCur;

                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                          <td style={{ fontWeight: 600, padding: '10px', color: 'var(--text-primary)' }}>{detail.metric}</td>
                          <td style={{ textAlign: 'right', padding: '10px', color: 'var(--text-secondary)' }}>
                            {formattedPrev}{detail.unit}
                          </td>
                          <td style={{ textAlign: 'right', padding: '10px', fontWeight: 700, color: 'var(--text-primary)' }}>
                            {formattedCur}{detail.unit}
                          </td>
                          <td style={{
                            textAlign: 'right',
                            padding: '10px',
                            fontWeight: 700,
                            color: isZero ? 'var(--text-secondary)' : isPositive ? 'var(--primary-rose)' : 'var(--primary-cyan)'
                          }}>
                            {isZero ? '-' : `${isPositive ? '+' : ''}${Math.round(diffPercent)}%`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="modal-actions" style={{ marginTop: '24px' }}>
              <button 
                type="button" 
                className="btn-premium" 
                style={{
                  background: 'linear-gradient(135deg, var(--primary-cyan), var(--primary-blue))',
                  padding: '10px 24px',
                  fontSize: '0.85rem'
                }} 
                onClick={() => setSelectedAnomaly(null)}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
         V3.16.5: 전체 활성 광고주 목록 팝업 모달
         ======================================================== */}
      {showActiveAdvertisersModal && (
        <div className="modal-overlay" onClick={() => { setShowActiveAdvertisersModal(false); setActiveSearchTerm(''); }}>
          <div className="modal-card glass-panel" style={{ maxWidth: '950px', width: '95%', padding: '28px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header" style={{ flexShrink: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  color: 'var(--primary-cyan)',
                  letterSpacing: '1px'
                }}>
                  ACTIVE ADVERTISERS LIST
                </span>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                  🔗 실시간 활성 광고주 목록 (총 {activeAdvertisers.length}개사)
                </h3>
              </div>
              <button className="btn-modal-close" onClick={() => { setShowActiveAdvertisersModal(false); setActiveSearchTerm(''); }}>×</button>
            </div>

            {/* 검색 필터 */}
            <div style={{ margin: '20px 0 12px 0', flexShrink: 0 }}>
              <input
                type="text"
                placeholder="🔍 광고주명 또는 고객 ID 실시간 필터링..."
                className="search-input"
                style={{ width: '100%', fontSize: '0.85rem', padding: '10px 16px', background: 'rgba(15, 23, 42, 0.6)' }}
                value={activeSearchTerm}
                onChange={(e) => setActiveSearchTerm(e.target.value)}
              />
            </div>

            {/* 광고주 테이블 리스트 */}
            <div style={{ flexGrow: 1, overflowY: 'auto', marginTop: '10px', background: 'rgba(15, 23, 42, 0.2)', borderRadius: '12px', border: '1px solid var(--panel-border)' }}>
              <table className="premium-table" style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0f172a' }}>
                  <tr>
                    <th style={{ padding: '12px 16px', textAlign: 'left', color: 'var(--text-secondary)' }}>순위 / 광고주명</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', color: 'var(--text-secondary)' }}>고객 ID</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text-secondary)' }}>어제 소진 광고비</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text-secondary)' }}>어제 구매완료수</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text-secondary)' }}>어제 구매 ROAS</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text-secondary)' }}>최근 30일 소진비</th>
                    <th style={{ padding: '12px 16px', textAlign: 'center', color: 'var(--text-secondary)', width: '60px' }}>관제</th>
                  </tr>
                </thead>
                <tbody>
                  {activeAdvertisers
                    .filter(acc => {
                      const term = activeSearchTerm.toLowerCase();
                      return acc.ad_account_name.toLowerCase().includes(term) || acc.customer_id.includes(term);
                    })
                    .map((acc, idx) => (
                      <tr 
                        key={acc.customer_id}
                        onClick={() => {
                          setSelectedAccountId(acc.customer_id);
                          setShowActiveAdvertisersModal(false);
                          setActiveSearchTerm('');
                        }}
                        style={{ 
                          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <td style={{ padding: '12px 16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{
                            display: 'inline-flex',
                            width: '20px',
                            height: '20px',
                            background: idx === 0 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                            borderRadius: '50%',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.7rem',
                            color: idx === 0 ? '#f59e0b' : 'var(--text-secondary)',
                            border: idx === 0 ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid rgba(255,255,255,0.05)'
                          }}>
                            {idx + 1}
                          </span>
                          <span style={{ color: idx === 0 ? '#f8fafc' : '#e2e8f0' }}>{acc.ad_account_name}</span>
                        </td>
                        <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{acc.customer_id}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--primary-rose)' }}>{formatNumber(Math.round(acc.yesterdayCost))}원</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--primary-emerald)' }}>{formatNumber(acc.yesterdayPurchase)}건</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--primary-amber)' }}>{acc.avgRoas.toFixed(1)}%</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', color: '#ffffff', fontWeight: 600 }}>{formatNumber(Math.round(acc.total30Cost))}원</td>
                        <td style={{ padding: '12px 16px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={(e) => handleToggleFavorite(e, acc.customer_id)}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '1.1rem',
                              padding: '2px',
                              color: acc.is_favorite ? 'var(--primary-rose)' : 'rgba(255, 255, 255, 0.2)',
                              textShadow: acc.is_favorite ? '0 0 6px rgba(244, 63, 94, 0.5)' : 'none',
                              transition: 'all 0.15s ease'
                            }}
                            title={acc.is_favorite ? "주요 관제 지정 해제" : "주요 관제 지정"}
                          >
                            {acc.is_favorite ? '★' : '☆'}
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div className="modal-actions" style={{ marginTop: '20px', flexShrink: 0 }}>
              <button 
                type="button" 
                className="btn-sidebar-secondary" 
                style={{ width: 'auto', padding: '10px 24px', margin: 0 }}
                onClick={() => { setShowActiveAdvertisersModal(false); setActiveSearchTerm(''); }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
         비밀번호 변경 모달 팝업
         ======================================================== */}
      {showPasswordModal && (
        <div className="modal-overlay">
          <div className="modal-card glass-panel" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3>⚙️ 개인 정보 및 비밀번호 변경</h3>
              <button className="btn-modal-close" onClick={() => setShowPasswordModal(false)}>×</button>
            </div>
            
            <form onSubmit={handleChangeProfile} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
              {passwordError && <div className="error-alert" style={{ fontSize: '0.75rem', padding: '8px' }}>{passwordError}</div>}
              {passwordSuccess && <div className="success-alert">{passwordSuccess}</div>}
              
              <div className="input-group">
                <label className="input-label" style={{ fontSize: '0.65rem' }}>사용자 이름 (실명)</label>
                <input
                  type="text"
                  className="login-input"
                  style={{ padding: '10px 14px', fontSize: '0.85rem' }}
                  value={editProfileName}
                  onChange={(e) => setEditProfileName(e.target.value)}
                  disabled={changingPassword}
                  required
                />
              </div>

              <div className="input-group">
                <label className="input-label" style={{ fontSize: '0.65rem' }}>현재 비밀번호 (본인 확인용)</label>
                <input
                  type="password"
                  className="login-input"
                  style={{ padding: '10px 14px', fontSize: '0.85rem' }}
                  placeholder="현재 비밀번호를 입력하세요"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  disabled={changingPassword}
                  required
                />
              </div>

              <div className="input-group">
                <label className="input-label" style={{ fontSize: '0.65rem' }}>새 비밀번호 (선택 사항)</label>
                <input
                  type="password"
                  className="login-input"
                  style={{ padding: '10px 14px', fontSize: '0.85rem' }}
                  placeholder="변경할 경우에만 입력하세요"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={changingPassword}
                />
              </div>

              <div className="input-group">
                <label className="input-label" style={{ fontSize: '0.65rem' }}>새 비밀번호 확인</label>
                <input
                  type="password"
                  className="login-input"
                  style={{ padding: '10px 14px', fontSize: '0.85rem' }}
                  placeholder="새 비밀번호를 다시 입력하세요"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={changingPassword}
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-sidebar-secondary" onClick={() => setShowPasswordModal(false)} disabled={changingPassword}>
                  취소
                </button>
                <button type="submit" className="btn-premium" style={{ padding: '10px 16px' }} disabled={changingPassword}>
                  {changingPassword ? '저장 중...' : '저장 및 변경'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
         (ADMIN 전용) 사용자 추가/수정 모달 팝업
         ======================================================== */}
      {showUserModal && currentUser?.role === 'ADMIN' && (
        <div className="modal-overlay">
          <div className="modal-card glass-panel" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3>👤 {modalUserTitle}</h3>
              <button className="btn-modal-close" onClick={() => setShowUserModal(false)}>×</button>
            </div>
            
            <form onSubmit={handleSaveUser} style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '16px' }}>
              {userModalError && <div className="error-alert" style={{ fontSize: '0.75rem', padding: '8px' }}>{userModalError}</div>}
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="input-group">
                  <label className="input-label" style={{ fontSize: '0.65rem' }}>사용자 이름 (실명)</label>
                  <input
                    type="text"
                    className="login-input"
                    style={{ padding: '10px 14px', fontSize: '0.85rem' }}
                    placeholder="예: 홍길동"
                    value={formUserName}
                    onChange={(e) => setFormUserName(e.target.value)}
                    disabled={savingUser}
                    required
                  />
                </div>

                <div className="input-group">
                  <label className="input-label" style={{ fontSize: '0.65rem' }}>로그인 ID</label>
                  <input
                    type="text"
                    className="login-input"
                    style={{ padding: '10px 14px', fontSize: '0.85rem' }}
                    placeholder="예: gildong"
                    value={formLoginId}
                    onChange={(e) => setFormLoginId(e.target.value)}
                    disabled={savingUser || !!editingUserId} // 수정 시 ID 변경 방지
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="input-group">
                  <label className="input-label" style={{ fontSize: '0.65rem' }}>권한 역할 (Role)</label>
                  <select
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value)}
                    className="admin-select-input"
                    style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid var(--panel-border)', padding: '10px 14px', borderRadius: '12px', fontSize: '0.85rem', color: '#f8fafc', outline: 'none' }}
                  >
                    <option value="USER">USER (일반 사용자)</option>
                    <option value="ADMIN">ADMIN (최고 관리자)</option>
                  </select>
                </div>

                <div className="input-group">
                  <label className="input-label" style={{ fontSize: '0.65rem' }}>
                    {editingUserId ? '비밀번호 강제 재설정 (선택)' : '초기 비밀번호 (고정)'}
                  </label>
                  <input
                    type="password"
                    className="login-input"
                    style={{ padding: '10px 14px', fontSize: '0.85rem' }}
                    placeholder={editingUserId ? '변경 시에만 입력' : '최초 등록 시 0000 강제 설정'}
                    value={editingUserId ? formPassword : '0000'}
                    onChange={(e) => setFormPassword(e.target.value)}
                    disabled={savingUser || !editingUserId} // 신규 등록 시에는 '0000' 고정
                  />
                </div>
              </div>

              <div className="input-group">
                <label className="input-label" style={{ fontSize: '0.65rem' }}>NAVER API KEY</label>
                <input
                  type="text"
                  className="login-input"
                  style={{ padding: '10px 14px', fontSize: '0.8rem', fontFamily: 'monospace' }}
                  placeholder="0100000000..."
                  value={formNaverApiKey}
                  onChange={(e) => setFormNaverApiKey(e.target.value)}
                  disabled={savingUser}
                  required
                />
              </div>

              <div className="input-group">
                <label className="input-label" style={{ fontSize: '0.65rem' }}>NAVER SECRET KEY</label>
                <input
                  type="text"
                  className="login-input"
                  style={{ padding: '10px 14px', fontSize: '0.8rem', fontFamily: 'monospace' }}
                  placeholder="AQAAAAB..."
                  value={formNaverSecretKey}
                  onChange={(e) => setFormNaverSecretKey(e.target.value)}
                  disabled={savingUser}
                  required
                />
              </div>

              <div className="input-group">
                <label className="input-label" style={{ fontSize: '0.65rem' }}>NAVER CUSTOMER ID (매니저 계정 ID)</label>
                <input
                  type="text"
                  className="login-input"
                  style={{ padding: '10px 14px', fontSize: '0.85rem' }}
                  placeholder="예: 1282664"
                  value={formNaverCustomerId}
                  onChange={(e) => setFormNaverCustomerId(e.target.value)}
                  disabled={savingUser}
                  required
                />
              </div>

              <div className="modal-actions" style={{ marginTop: '10px' }}>
                <button type="button" className="btn-sidebar-secondary" onClick={() => setShowUserModal(false)} disabled={savingUser}>
                  취소
                </button>
                <button type="submit" className="btn-premium" style={{ padding: '10px 16px' }} disabled={savingUser}>
                  {savingUser ? '저장 중...' : '사용자 저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
         AI 성과 브리핑 임계값 커스텀 설정 모달 (V3.13)
         ======================================================== */}
      {showSettingsModal && (
        <div className="modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="modal-card glass-panel" style={{ maxWidth: '520px', width: '95%', padding: '28px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--primary-cyan)', letterSpacing: '1px' }}>
                  AI BRIEFING OPTION
                </span>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                  ⚙️ AI 브리핑 임계값(최소컷) 커스텀 설정
                </h3>
              </div>
              <button className="btn-modal-close" onClick={() => setShowSettingsModal(false)}>×</button>
            </div>

            <form onSubmit={handleSaveSettings} style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.5', background: 'rgba(255, 255, 255, 0.02)', padding: '12px 16px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
                ℹ️ 여기서 설정한 최소 임계값 기준을 초과하는 성과가 기록된 캠페인 및 광고그룹만을 정밀 스캔하여 이상 징후(Anomaly)와 기간 변동(PoP) 인사이트 피드를 빌드합니다.
              </div>

              {/* A. 일일(Daily) 임계값 설정군 */}
              <div style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', padding: '16px', background: 'rgba(15, 23, 42, 0.3)' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '0.85rem', fontWeight: 700, color: 'var(--primary-rose)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  📅 일일(Daily) 성과 분석 임계값 (1일 증분 분석용)
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>최소 일 광고비</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="number"
                        className="login-input"
                        style={{ width: '130px', padding: '6px 12px', fontSize: '0.85rem', textAlign: 'right' }}
                        value={dailyMinCost}
                        onChange={(e) => setDailyMinCost(Math.max(0, parseInt(e.target.value) || 0))}
                        min="0"
                        required
                      />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>원 이상</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>최소 일 노출수</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="number"
                        className="login-input"
                        style={{ width: '130px', padding: '6px 12px', fontSize: '0.85rem', textAlign: 'right' }}
                        value={dailyMinImp}
                        onChange={(e) => setDailyMinImp(Math.max(0, parseInt(e.target.value) || 0))}
                        min="0"
                        required
                      />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>회 이상</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>최소 일 구매완료수</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="number"
                        step="0.1"
                        className="login-input"
                        style={{ width: '130px', padding: '6px 12px', fontSize: '0.85rem', textAlign: 'right' }}
                        value={dailyMinPurchase}
                        onChange={(e) => setDailyMinPurchase(Math.max(0, parseFloat(e.target.value) || 0))}
                        min="0"
                        required
                      />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>건 이상</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* B. 기간(Period) 임계값 설정군 */}
              <div style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', padding: '16px', background: 'rgba(15, 23, 42, 0.3)' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '0.85rem', fontWeight: 700, color: 'var(--primary-emerald)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  📊 기간(Period) 성과 변동 임계값 (PoP 비교용)
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>최소 누적 광고비</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="number"
                        className="login-input"
                        style={{ width: '130px', padding: '6px 12px', fontSize: '0.85rem', textAlign: 'right' }}
                        value={periodMinCost}
                        onChange={(e) => setPeriodMinCost(Math.max(0, parseInt(e.target.value) || 0))}
                        min="0"
                        required
                      />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>원 이상</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>최소 누적 노출수</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="number"
                        className="login-input"
                        style={{ width: '130px', padding: '6px 12px', fontSize: '0.85rem', textAlign: 'right' }}
                        value={periodMinImp}
                        onChange={(e) => setPeriodMinImp(Math.max(0, parseInt(e.target.value) || 0))}
                        min="0"
                        required
                      />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>회 이상</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>최소 누적 구매완료수</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="number"
                        className="login-input"
                        style={{ width: '130px', padding: '6px 12px', fontSize: '0.85rem', textAlign: 'right' }}
                        value={periodMinPurchase}
                        onChange={(e) => setPeriodMinPurchase(Math.max(0, parseInt(e.target.value) || 0))}
                        min="0"
                        required
                      />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>건 이상</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 버튼 하단 영역 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={handleResetSettings}
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'var(--text-secondary)',
                    padding: '8px 14px',
                    borderRadius: '10px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'var(--transition-smooth)'
                  }}
                  title="네이버 프리미엄 대시보드 권장 기본값으로 복원합니다."
                >
                  ↩️ 기본값 복원
                </button>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn-sidebar-secondary"
                    style={{ margin: 0, padding: '8px 16px', borderRadius: '10px' }}
                    onClick={() => setShowSettingsModal(false)}
                    disabled={savingSettings}
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    className="btn-premium"
                    style={{
                      background: 'linear-gradient(135deg, var(--primary-cyan), var(--primary-blue))',
                      boxShadow: '0 0 15px rgba(6, 182, 212, 0.3)',
                      padding: '8px 20px',
                      borderRadius: '10px',
                      fontSize: '0.82rem',
                      fontWeight: 700
                    }}
                    disabled={savingSettings}
                  >
                    {savingSettings ? '저장 중...' : '💾 저장 후 AI 재스캐닝'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
         V3.13: AI 브리핑 지표 스캐닝 & 피드 재조립 연산 진행률(0%~100%) 오버레이 모달
         ======================================================== */}
      {updatingBriefingFeed && (
        <div className="modal-overlay" style={{ zIndex: 99999 }}>
          <div className="modal-card glass-panel" style={{ maxWidth: '440px', width: '90%', padding: '36px', textAlign: 'center', boxShadow: '0 20px 50px rgba(0, 0, 0, 0.4)', border: '1px solid rgba(6, 182, 212, 0.3)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
              
              {/* 회전하는 AI 펄스 링 연출 */}
              <div className="ai-pulse-spinner" />
              
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', margin: 0, letterSpacing: '-0.5px' }}>
                AI 인공지능 지표 스캐닝 진행 중
              </h3>
              
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.5' }}>
                새로 설정된 임계값을 기준으로 광고 데이터의<br />
                이상 징후 및 성과 변동 추이를 정밀 재분석하고 있습니다.
              </p>

              <div style={{ fontSize: '3.2rem', fontWeight: 950, color: 'var(--primary-cyan)', fontFamily: 'system-ui, sans-serif', textShadow: '0 0 25px rgba(6, 182, 212, 0.5)', margin: '5px 0' }}>
                {briefingUpdateProgress}%
              </div>

              {/* 프로그레스바 */}
              <div style={{ width: '100%', height: '8px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{
                  width: `${briefingUpdateProgress}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, var(--primary-cyan), var(--primary-blue))',
                  borderRadius: '10px',
                  transition: 'width 0.15s linear',
                  boxShadow: '0 0 10px rgba(6, 182, 212, 0.6)'
                }} />
              </div>

              {/* 진행률별 동적 AI 스캐닝 텍스트 */}
              <div style={{ marginTop: '8px', width: '100%', minHeight: '36px' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--primary-cyan)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>
                  {briefingUpdateProgress < 25 ? 'STAGE 1: PARSING PARAMETERS'
                   : briefingUpdateProgress < 50 ? 'STAGE 2: DATA LOADING'
                   : briefingUpdateProgress < 75 ? 'STAGE 3: ANOMALY DETECTION'
                   : briefingUpdateProgress < 100 ? 'STAGE 4: FEED GENERATION'
                   : 'STAGE 5: COMPLETE'}
                </div>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {briefingUpdateProgress < 25 ? '🌀 AI 엔진 가동 및 광고주 설정 파라미터 로딩 중...'
                   : briefingUpdateProgress < 50 ? '📊 최근 30일 누적 성과 원시 데이터 파싱 중...'
                   : briefingUpdateProgress < 75 ? '🔍 설정된 임계값 기반 Anomaly 및 PoP 패턴 스캐닝 진행 중...'
                   : briefingUpdateProgress < 100 ? '💡 성과 브리핑 요약문 최적화 및 인사이트 피드 재조립 중...'
                   : '✅ AI 지표 스캐닝 완료! 브리핑 피드를 최신화합니다.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
         실시간 동기화 진행 상태 표시 모달 (SSE 스트리밍 연동)
         ======================================================== */}
      {syncingCampaigns && (
        <div className="modal-overlay" style={{ zIndex: 9999 }}>
          <div className="modal-card glass-panel" style={{ maxWidth: '460px', width: '90%', padding: '32px', textAlign: 'center', boxShadow: '0 20px 50px rgba(0, 0, 0, 0.4)', border: '1px solid rgba(251, 146, 60, 0.3)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              <div className="sync-pulse-spinner" />
              
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', margin: 0, letterSpacing: '-0.5px' }}>
                광고주 성과 실시간 동기화 중
              </h3>
              
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 10px 0', lineHeight: '1.5' }}>
                네이버 광고 API 429 차단(Rate Limit) 방지를 위해<br />
                지능형 백오프 딜레이를 적용하여 안전하게 데이터를 수집하고 있습니다.
              </p>

              <div style={{ fontSize: '3rem', fontWeight: 900, color: 'var(--primary-rose)', fontFamily: 'system-ui, sans-serif', textShadow: '0 0 20px rgba(244, 63, 94, 0.4)', margin: '10px 0' }}>
                {syncProgress}%
              </div>

              <div style={{ width: '100%', height: '8px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{
                  width: `${syncProgress}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, var(--primary-rose), var(--primary-cyan))',
                  borderRadius: '10px',
                  transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                  boxShadow: '0 0 10px rgba(244, 63, 94, 0.6)'
                }} />
              </div>

              <div style={{ marginTop: '8px', width: '100%' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--primary-cyan)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>
                  {syncStage || 'INITIALIZE'}
                </div>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {syncMessage || '동기화 연결을 시작하는 중...'}
                </div>
              </div>

              <div style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.3)', marginTop: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '12px', width: '100%' }}>
                ⚠️ 동기화 도중 브라우저 창을 닫거나 새로고침하지 마세요.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 글로벌 스타일 오버레이 모달 */}
      <style jsx global>{`
        /* ADMIN 포털 CSS 효과 */
        @keyframes alertsPulse {
          0% { border-color: rgba(244, 63, 94, 0.25); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 0 10px rgba(244, 63, 94, 0.05); }
          100% { border-color: rgba(244, 63, 94, 0.55); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 0 25px rgba(244, 63, 94, 0.25); }
        }
        .urgent-pulse-title {
          display: flex;
          align-items: center;
        }
        .urgent-pulse-dot {
          width: 8px;
          height: 8px;
          background-color: #ef4444;
          border-radius: 50%;
          display: inline-block;
          box-shadow: 0 0 10px #ef4444;
          animation: dotPulse 1.5s infinite;
        }
        @keyframes dotPulse {
          0% { transform: scale(0.8); opacity: 0.5; }
          50% { transform: scale(1.2); opacity: 1; box-shadow: 0 0 15px #ef4444; }
          100% { transform: scale(0.8); opacity: 0.5; }
        }
        .urgent-alert-card {
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .urgent-alert-card:hover {
          transform: translateY(-2px);
          border-color: rgba(244, 63, 94, 0.4) !important;
          background: rgba(30, 41, 59, 0.8) !important;
          box-shadow: 0 10px 25px rgba(244, 63, 94, 0.15);
        }
        .active-advertiser-portal-card {
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .active-advertiser-portal-card:hover {
          transform: translateY(-4px) scale(1.02);
          border-color: var(--primary-cyan) !important;
          background: rgba(30, 41, 59, 0.5) !important;
          box-shadow: 0 12px 30px rgba(6, 182, 212, 0.2);
        }

        /* AI 스캐닝 스피너 및 펄스 효과 */
        @keyframes aiPulse {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(6, 182, 212, 0.5); }
          70% { transform: scale(1); box-shadow: 0 0 0 20px rgba(6, 182, 212, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(6, 182, 212, 0); }
        }
        .ai-pulse-spinner {
          width: 56px;
          height: 56px;
          background: radial-gradient(circle, var(--primary-cyan) 0%, rgba(6, 182, 212, 0.2) 100%);
          border-radius: 50%;
          animation: aiPulse 2s infinite;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .ai-pulse-spinner::after {
          content: '🤖';
          font-size: 1.6rem;
          animation: spin 3s linear infinite;
        }

        /* 실시간 동기화 SSE 스피너 및 펄스 효과 */
        @keyframes syncPulse {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(244, 63, 94, 0.5); }
          70% { transform: scale(1); box-shadow: 0 0 0 20px rgba(244, 63, 94, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(244, 63, 94, 0); }
        }
        .sync-pulse-spinner {
          width: 56px;
          height: 56px;
          background: radial-gradient(circle, var(--primary-rose) 0%, rgba(244, 63, 94, 0.2) 100%);
          border-radius: 50%;
          animation: syncPulse 2s infinite;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .sync-pulse-spinner::after {
          content: '🔄';
          font-size: 1.6rem;
          animation: spin 3s linear infinite;
        }
        @keyframes spin {
          100% { transform: rotate(360deg); }
        }

        /* 인사이트 피드 카드 호버 효과 */
        .insight-feed-card {
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .insight-feed-card:hover {
          transform: translateX(4px) translateY(-1px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
          filter: brightness(1.15);
        }

        /* 어드민 셀렉트 박스 */
        .admin-user-selector-container {
          margin-bottom: 24px;
          padding: 0 8px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .admin-select-input {
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(244, 63, 94, 0.4);
          padding: 8px 12px;
          border-radius: 10px;
          color: var(--primary-rose);
          font-size: 0.85rem;
          font-weight: 700;
          outline: none;
          cursor: pointer;
          width: 100%;
          transition: var(--transition-smooth);
        }

        .admin-select-input:focus {
          border-color: var(--primary-rose);
          box-shadow: 0 0 10px rgba(244, 63, 94, 0.2);
        }

        /* 사이드바 하단 프로필 섹션 */
        .sidebar-footer-container {
          border-top: 1px solid var(--panel-border);
          padding: 16px 8px 0 8px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .user-profile-widget {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .user-profile-name {
          font-size: 0.9rem;
          font-weight: 700;
          color: var(--text-primary);
        }

        .user-profile-role {
          font-size: 0.72rem;
          color: var(--text-secondary);
          font-weight: 600;
        }

        .sidebar-action-buttons {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .btn-sidebar-secondary {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--panel-border);
          color: var(--text-secondary);
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          transition: var(--transition-smooth);
          width: 100%;
          text-align: left;
        }

        .btn-sidebar-secondary:hover {
          background: rgba(255, 255, 255, 0.08);
          color: var(--text-primary);
        }

        .btn-sidebar-danger {
          background: rgba(244, 63, 94, 0.05);
          border: 1px solid rgba(244, 63, 94, 0.2);
          color: var(--primary-rose);
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 0.75rem;
          font-weight: 700;
          cursor: pointer;
          transition: var(--transition-smooth);
          width: 100%;
          text-align: left;
        }

        .btn-sidebar-danger:hover {
          background: rgba(244, 63, 94, 0.15);
        }

        /* 지능형 데이터 누락 감지 배너 (V3.11) */
        .data-gap-warning-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 24px;
          background: rgba(251, 146, 60, 0.08) !important;
          border: 1px solid rgba(251, 146, 60, 0.3) !important;
          border-radius: 16px;
          margin-bottom: 24px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 0 15px rgba(251, 146, 60, 0.1);
          animation: bannerFadeIn 0.3s ease-out, bannerPulse 3s infinite alternate;
          transition: all 0.3s ease;
        }
        @keyframes bannerFadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes bannerPulse {
          0% { border-color: rgba(251, 146, 60, 0.2); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 0 10px rgba(251, 146, 60, 0.05); }
          100% { border-color: rgba(251, 146, 60, 0.45); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 0 20px rgba(251, 146, 60, 0.2); }
        }
        .banner-icon {
          font-size: 1.6rem;
        }
        .banner-title {
          font-size: 0.92rem;
          font-weight: 800;
          color: #ff9d5c;
          margin: 0 0 4px 0;
          letter-spacing: -0.3px;
        }
        .banner-desc {
          font-size: 0.8rem;
          color: var(--text-secondary);
          margin: 0;
          line-height: 1.5;
        }
        .banner-desc strong {
          color: var(--text-primary);
        }
        .btn-banner-sync {
          transition: all 0.25s ease !important;
        }
        .btn-banner-sync:hover {
          transform: translateY(-1px);
          box-shadow: 0 0 25px rgba(244, 63, 94, 0.6) !important;
          filter: brightness(1.1);
        }
        .btn-banner-close:hover {
          background: rgba(255, 255, 255, 0.15) !important;
          color: var(--text-primary) !important;
        }

        /* 모달 팝업 오버레이 */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          animation: fade-in 0.2s ease-out;
        }

        .modal-card {
          width: 100%;
          padding: 32px;
          background: rgba(30, 41, 59, 0.6) !important;
          border-radius: 20px;
          box-shadow: 0 20px 50px rgba(0,0,0,0.6);
          position: relative;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid var(--panel-border);
          padding-bottom: 14px;
        }

        .modal-header h3 {
          font-size: 1.1rem;
          font-weight: 800;
          color: #f8fafc;
        }

        .btn-modal-close {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-size: 1.5rem;
          cursor: pointer;
          line-height: 1;
        }

        .btn-modal-close:hover {
          color: var(--text-primary);
        }

        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 20px;
        }

        .success-alert {
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.25);
          color: var(--primary-emerald);
          padding: 10px;
          border-radius: 8px;
          font-size: 0.8rem;
          font-weight: 600;
          text-align: center;
        }

        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
