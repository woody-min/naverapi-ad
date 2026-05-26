'use client';

import { useState, useEffect, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface AdvertiserAccount {
  customer_id: string;
  ad_account_no: string;
  ad_account_name: string;
  owner_naver_id: string;
  account_role: string;
  last_synced_at: string;
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
  
  // 3-tier 아코디언 펼침 ID 세트
  const [expandedCampaignIds, setExpandedCampaignIds] = useState<Set<string>>(new Set());
  const [expandedAdgroupIds, setExpandedAdgroupIds] = useState<Set<string>>(new Set());

  // 날짜 설정 프리셋
  const [datePreset, setDatePreset] = useState<DatePreset>('yesterday');
  
  // 직접 선택(Custom Range) 날짜 상태
  const [customSince, setCustomSince] = useState<string>('');
  const [customUntil, setCustomUntil] = useState<string>('');
  
  // 상태 관리 세분화
  const [loadingAccounts, setLoadingAccounts] = useState<boolean>(true);
  const [loadingCampaigns, setLoadingCampaigns] = useState<boolean>(false);
  const [loadingAdgroups, setLoadingAdgroups] = useState<boolean>(false);
  const [loadingAds, setLoadingAds] = useState<boolean>(false);
  const [syncingAccounts, setSyncingAccounts] = useState<boolean>(false);
  const [syncingCampaigns, setSyncingCampaigns] = useState<boolean>(false);
  
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
          since: customSince || formatDate(yesterday),
          until: customUntil || formatDate(yesterday)
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

  // C-3. AI 인사이트 및 Anomaly 연산 엔진
  const runInsightEngine = (
    campRaw: any[],
    adgRaw: any[],
    adRaw: any[],
    expectedSince: string,
    expectedUntil: string
  ) => {
    if (!campRaw || campRaw.length === 0) {
      setAnomalyFeed([]);
      setPopFeed([]);
      return;
    }

    const sortedDates = Array.from(new Set(campRaw.map(r => r.date))).sort();
    if (sortedDates.length < 2) {
      setAnomalyFeed([]);
      setPopFeed([]);
      return;
    }

    const latestDate = sortedDates[sortedDates.length - 1];
    const priorDates = sortedDates.slice(0, sortedDates.length - 1);
    const priorDaysCount = priorDates.length;

    const newAnomalyFeed: any[] = [];
    const newPopFeed: any[] = [];

    // --- A. 최근 1일 증분 이상 분석 (Latest Daily Increment Anomaly) ---
    const campLatest = campRaw.filter(r => r.date === latestDate);
    const campPrior = campRaw.filter(r => r.date !== latestDate);

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
      const avgCost = prior.cost / priorDaysCount;
      const avgPurchaseCcnt = prior.purchaseCcnt / priorDaysCount;
      const avgRoas = prior.cost > 0 ? (prior.purchaseConvAmt / prior.cost) * 100 : 0;

      const curImp = row.imp_cnt || 0;
      const curCost = row.sales_amt || 0;
      const curPurchaseCcnt = row.purchase_ccnt || 0;
      const curRoas = curCost > 0 ? (row.purchase_conv_amt / curCost) * 100 : 0;

      // 1. 광고비 변동 감지
      if (avgCost > 1000) {
        const costRatio = curCost / avgCost;
        if (costRatio >= 2.0) {
          newAnomalyFeed.push({
            type: 'SURGE_COST',
            level: 'CAMPAIGN',
            name: row.campaign_name,
            message: `캠페인 일 광고비가 평소(일 평균 ${formatNumber(Math.round(avgCost))}원) 대비 **${((costRatio - 1) * 100).toFixed(0)}% 폭증**한 **${formatNumber(curCost)}원** 소진되어 예산 과소진 징후를 감지했습니다.`,
            ratio: costRatio
          });
        } else if (curCost <= avgCost * 0.15 && row.campaign_status === 'ELIGIBLE') {
          newAnomalyFeed.push({
            type: 'DROP_COST',
            level: 'CAMPAIGN',
            name: row.campaign_name,
            message: `캠페인 일 광고비가 평소(일 평균 ${formatNumber(Math.round(avgCost))}원) 대비 **${((1 - costRatio) * 100).toFixed(0)}% 급감**한 **${formatNumber(curCost)}원** 소진에 그쳤습니다. (ON 상태이나 소진 멈춤 감지)`,
            ratio: costRatio
          });
        }
      }

      // 2. 트래픽(노출수) 변동 감지
      if (avgImp > 100) {
        const impRatio = curImp / avgImp;
        if (impRatio >= 2.5) {
          newAnomalyFeed.push({
            type: 'SPIKE_TRAFFIC',
            level: 'CAMPAIGN',
            name: row.campaign_name,
            message: `캠페인 하루 노출수가 평소(일 평균 ${formatNumber(Math.round(avgImp))}회) 대비 **${((impRatio - 1) * 100).toFixed(0)}% 폭증**한 **${formatNumber(curImp)}회**를 기록했습니다!`,
            ratio: impRatio
          });
        }
      }

      // 3. 구매 전환수 급증/급감 감지
      if (avgPurchaseCcnt > 0.3) {
        const purchaseRatio = curPurchaseCcnt / avgPurchaseCcnt;
        if (purchaseRatio >= 2.0) {
          newAnomalyFeed.push({
            type: 'SURGE_PURCHASE',
            level: 'CAMPAIGN',
            name: row.campaign_name,
            message: `캠페인 일 구매완료 수가 평소(일 평균 ${avgPurchaseCcnt.toFixed(1)}건) 대비 **${((purchaseRatio - 1) * 100).toFixed(0)}% 폭증**한 **${curPurchaseCcnt}건**을 기록하며 폭발적인 효율을 기록했습니다!`,
            ratio: purchaseRatio
          });
        } else if (purchaseRatio <= 0.2) {
          newAnomalyFeed.push({
            type: 'DROP_PURCHASE',
            level: 'CAMPAIGN',
            name: row.campaign_name,
            message: `캠페인 일 구매완료 수가 평소(일 평균 ${avgPurchaseCcnt.toFixed(1)}건) 대비 **${((1 - purchaseRatio) * 100).toFixed(0)}% 급감**한 **${curPurchaseCcnt}건**에 그쳤습니다. 상세 설정이나 상세 페이지 품절 여부를 체크하세요!`,
            ratio: purchaseRatio
          });
        }
      } else if (avgPurchaseCcnt > 0 && curPurchaseCcnt === 0 && priorDaysCount >= 3) {
        newAnomalyFeed.push({
          type: 'ZERO_PURCHASE',
          level: 'CAMPAIGN',
          name: row.campaign_name,
          message: `평소 꾸준히 구매 전환이 일어나던 캠페인이나, 오늘 하루 **구매 완료가 0건**에 그쳤습니다. 전환 링크 작동 여부를 점검해 보세요.`,
          ratio: 0
        });
      }

      // 4. 광고수익률(ROAS) 급증/급감 감지
      if (avgRoas > 10 && curCost > 1000) {
        const roasRatio = curRoas / avgRoas;
        if (roasRatio >= 1.5) {
          newAnomalyFeed.push({
            type: 'SURGE_ROAS',
            level: 'CAMPAIGN',
            name: row.campaign_name,
            message: `캠페인 하루 구매 ROAS가 평소(일 평균 ${avgRoas.toFixed(0)}%) 대비 **${((roasRatio - 1) * 100).toFixed(0)}% 급상승**한 **${curRoas.toFixed(0)}%**를 달성하여 광고 효율이 극대화되었습니다!`,
            ratio: roasRatio
          });
        } else if (roasRatio <= 0.3) {
          newAnomalyFeed.push({
            type: 'DROP_ROAS',
            level: 'CAMPAIGN',
            name: row.campaign_name,
            message: `캠페인 하루 구매 ROAS가 평소(일 평균 ${avgRoas.toFixed(0)}%) 대비 **${((1 - roasRatio) * 100).toFixed(0)}% 폭락**한 **${curRoas.toFixed(0)}%**에 그쳐 효율 저하 징후를 감지했습니다. 소재 교체 타이밍인지 확인해 보세요.`,
            ratio: roasRatio
          });
        }
      }
    });

    const adgLatest = adgRaw.filter(r => r.date === latestDate);
    const adgPrior = adgRaw.filter(r => r.date !== latestDate);

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

      const avgCost = prior.cost / priorDaysCount;
      const curCost = row.sales_amt || 0;

      if (avgCost > 3000 && curCost <= avgCost * 0.05 && row.adgroup_status === 'ELIGIBLE') {
        newAnomalyFeed.push({
          type: 'DROP_COST_ADGROUP',
          level: 'ADGROUP',
          name: row.adgroup_name,
          message: `광고그룹 일 소진액이 평소 일 평균(${formatNumber(Math.round(avgCost))}원) 대비 **95% 이상 급감**한 **${formatNumber(curCost)}원** 소진되었습니다. 광고 세팅 노출제한 여부나 링크 품절을 긴급 체크하세요!`,
          ratio: curCost / avgCost
        });
      }
    });

    // --- B. 직전 기간 대비 변동(Period over Period) 분석 피드 ---
    const campGrouped: { [key: string]: { imp: number; clk: number; cost: number; name: string } } = {};
    campPrior.forEach(row => {
      const cid = row.campaign_id;
      if (!campGrouped[cid]) campGrouped[cid] = { imp: 0, clk: 0, cost: 0, name: row.campaign_name };
      campGrouped[cid].imp += row.imp_cnt || 0;
      campGrouped[cid].clk += row.clk_cnt || 0;
      campGrouped[cid].cost += row.sales_amt || 0;
    });

    const latestAggregated: { [key: string]: { imp: number; clk: number; cost: number; name: string } } = {};
    campLatest.forEach(row => {
      const cid = row.campaign_id;
      if (!latestAggregated[cid]) latestAggregated[cid] = { imp: 0, clk: 0, cost: 0, name: row.campaign_name };
      latestAggregated[cid].imp += row.imp_cnt || 0;
      latestAggregated[cid].clk += row.clk_cnt || 0;
      latestAggregated[cid].cost += row.sales_amt || 0;
    });

    Object.keys(latestAggregated).forEach(cid => {
      const cur = latestAggregated[cid];
      const prev = campGrouped[cid];
      if (!prev) return;

      const prevAvgImp = prev.imp / priorDaysCount;
      const curImp = cur.imp;

      if (prevAvgImp > 50) {
        const changeRatio = (curImp - prevAvgImp) / prevAvgImp;
        if (changeRatio >= 0.25) {
          newPopFeed.push({
            type: 'TRAFFIC_GROWTH',
            name: cur.name,
            message: `노출 트래픽이 이전 일 평균 대비 **${(changeRatio * 100).toFixed(0)}% 급상승**하여 활성화 중입니다!`,
            ratio: changeRatio
          });
        } else if (changeRatio <= -0.25) {
          newPopFeed.push({
            type: 'TRAFFIC_DECLINE',
            name: cur.name,
            message: `노출 트래픽이 이전 일 평균 대비 **${(Math.abs(changeRatio) * 100).toFixed(0)}% 하락**하여 침체 구간에 진입했습니다.`,
            ratio: changeRatio
          });
        }
      }
    });

    setAnomalyFeed(newAnomalyFeed.slice(0, 5));
    setPopFeed(newPopFeed.slice(0, 5));
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

  // 2-0. Supabase 1,000개 기본 페이지네이션 제한 우회용 전체 데이터 병렬 조회 헬퍼 (결과 보장을 위한 결정적 정렬 및 격리 적용)
  const supabaseFetchAll = async (
    table: string,
    customerId: string,
    since: string,
    until: string,
    userId: string
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
        .eq('user_id', userId) // 멀티테넌트 격리 조건 강제
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
    nameField: string,
    userId: string
  ): Promise<any[]> => {
    let allData: any[] = [];
    let from = 0;
    const batchSize = 1000;
    
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select(`${idField}, ${nameField}`)
        .eq('customer_id', customerId)
        .eq('user_id', userId) // 멀티테넌트 격리 조건 강제
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
        supabaseFetchNames('campaign_stats', customerId, 'campaign_id', 'campaign_name', filterUserId),
        supabaseFetchNames('adgroup_stats', customerId, 'adgroup_id', 'adgroup_name', filterUserId)
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

    try {
      setLoadingCampaigns(true);
      setLoadingAdgroups(true);
      setLoadingAds(true);
      
      // DB에서 지정 날짜 범위로 데이터 병렬 조회 (페이지네이션, 정렬 및 격리 적용)
      const [campData, adgData, adData] = await Promise.all([
        supabaseFetchAll('campaign_stats', customerId, since, until, filterUserId),
        supabaseFetchAll('adgroup_stats', customerId, since, until, filterUserId),
        supabaseFetchAll('ad_stats', customerId, since, until, filterUserId)
      ]);

      // 며칠간의 데이터가 필요한지 기대치 계산
      const startDate = new Date(since);
      const endDate = new Date(until);
      const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
      const expectedDaysVal = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      setExpectedDays(expectedDaysVal);

      // DB에 현재 존재하는 고유 날짜 수 계산
      const distinctDatesInDb = new Set(campData.map(row => row.date)).size;

      // DB에 이 기간의 데이터가 아예 존재하지 않거나 불완전하게 적재된 경우 네이버 API 동기화 가동
      if ((campData.length === 0 || adgData.length === 0 || distinctDatesInDb < expectedDaysVal) && forceSyncIfEmpty) {
        console.log(`[Dashboard] DB 내 해당 기간(${since} ~ ${until})의 데이터가 불완전함 (가져온 날짜 수: ${distinctDatesInDb}/${expectedDaysVal}일). 실시간 동기화...`);
        await handleSyncCampaigns(customerId);
      } else {
        aggregateAndSetCampaigns(campData);
        aggregateAndSetAdgroups(adgData);
        aggregateAndSetAds(adData);
        // AI 성능 변동 및 이상 징후 감지 엔진 실시간 구동
        runInsightEngine(campData, adgData, adData, since, until);
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

  // 5. 특정 광고주 지정 기간의 캠페인 및 광고그룹 통계 실시간 동기화
  const handleSyncCampaigns = async (customerId: string) => {
    if (!currentUser || !customerId) return;
    const filterUserId = currentUser.role === 'ADMIN' ? selectedUserFilter : currentUser.id;
    if (!filterUserId) return;

    try {
      setSyncingCampaigns(true);
      let url = `/api/sync/campaigns?customerId=${customerId}`;
      if (datePreset === 'custom') {
        url += `&since=${since}&until=${until}`;
      } else {
        url += `&datePreset=${datePreset}`;
      }

      // ADMIN이 대리동기화 중이면 대상 targetUserId 전달
      if (currentUser.role === 'ADMIN' && selectedUserFilter) {
        url += `&targetUserId=${selectedUserFilter}`;
      }

      const response = await fetch(url, { method: 'POST' });
      const result = await response.json();
      
      if (result.success) {
        // 동기화 완료 후 DB에서 다시 범위 데이터 쿼리 및 마스터 이름 정보 비동기 갱신
        const [campData, adgData, adData] = await Promise.all([
          supabaseFetchAll('campaign_stats', customerId, since, until, filterUserId),
          supabaseFetchAll('adgroup_stats', customerId, since, until, filterUserId),
          supabaseFetchAll('ad_stats', customerId, since, until, filterUserId)
        ]);

        // 마스터 이름 캐시 최신화 (동기화 완료 후 비동기 호출)
        fetchMasterNames(customerId);

        aggregateAndSetCampaigns(campData);
        aggregateAndSetAdgroups(adgData);
        aggregateAndSetAds(adData);
        
        // 광고주 리스트의 갱신 시각 업데이트
        await fetchAccounts();
      } else {
        alert(`캠페인, 광고그룹, 소재 동기화 실패: ${result.error}`);
      }
    } catch (err: any) {
      alert(`동기화 중 오류 발생: ${err.message}`);
    } finally {
      setSyncingCampaigns(false);
    }
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

  // 선택된 계정, 날짜 프리셋 또는 커스텀 날짜 범위가 바뀔 때마다 캠페인, 광고그룹, 소재 데이터를 갱신
  useEffect(() => {
    if (selectedAccountId) {
      if (datePreset === 'custom' && (!customSince || !customUntil)) return;
      fetchCampaignAndAdGroupStats(selectedAccountId, true);
    } else {
      setCampaigns([]);
      setAdgroups([]);
      setAds([]);
    }
    setExpandedCampaignIds(new Set());
    setExpandedAdgroupIds(new Set());
  }, [selectedAccountId, datePreset, customSince, customUntil]);

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

  // 광고주 검색 필터
  const filteredAccounts = accounts.filter(acc => {
    const term = accountSearchTerm.toLowerCase();
    return (
      acc.ad_account_name.toLowerCase().includes(term) ||
      acc.customer_id.includes(term)
    );
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
          <div className="logo-section">
            <div className="logo-icon">N</div>
            <div className="logo-text">Premium Adboard</div>
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
                    setActiveTab('briefing'); // 계정 선택 시 강제로 AI 브리핑 탭으로 전환
                    setSelectedAccountId(acc.customer_id);
                  }}
                >
                  <span className="account-name">{acc.ad_account_name}</span>
                  <span className="account-id">고객 ID: {acc.customer_id}</span>
                  <span className="account-sync-time">
                    최근 갱신: {acc.last_synced_at ? new Date(acc.last_synced_at).toLocaleString('ko-KR', { hour12: false }) : '미동기화'}
                  </span>
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
                          💰 비즈머니 잔액: {formatNumber(bizmoneyBalance)}원
                        </span>
                      )}
                      {loadingBizmoney && (
                        <div className="spinner" style={{ width: '12px', height: '12px', borderTopColor: 'var(--primary-cyan)' }}></div>
                      )}
                    </>
                  ) 
                  : '네이버 검색광고 대시보드'}
            </h1>
            <p className="dashboard-subtitle">
              {activeTab === 'users'
                ? '관리자 전용 사용자 계정 CRUD 및 개별 네이버 API Credentials 등록/수정 제어 패널'
                : activeAccount 
                  ? `고객 ID: ${activeAccount.customer_id} (권한: ${activeAccount.account_role})` 
                  : '왼쪽 사이드바에서 광고주 계정을 선택하세요.'}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '4px' }}>
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
                onClick={() => handleSyncCampaigns(selectedAccountId)}
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
                    <span className="stat-value">{formatNumber(summary.totalCost)}원</span>
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
                              현재 광고 계정의 비즈머니 잔액이 <strong>{formatNumber(bizmoneyBalance)}원</strong> 남았습니다. 
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
                                <div key={i} style={{
                                  background: feed.type.startsWith('SURGE') || feed.type.startsWith('SPIKE') || feed.type.startsWith('ZERO') ? 'rgba(217, 70, 239, 0.05)' : 'rgba(244, 63, 94, 0.05)',
                                  borderLeft: '4px solid',
                                  borderLeftColor: feed.type.startsWith('SURGE') || feed.type.startsWith('SPIKE') || feed.type.startsWith('ZERO') ? 'var(--primary-rose)' : '#f43f5e',
                                  padding: '12px 16px',
                                  borderRadius: '0 8px 8px 0',
                                  fontSize: '0.82rem',
                                  lineHeight: '1.5'
                                }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <span style={{ fontWeight: 700, color: feed.type.startsWith('SURGE') || feed.type.startsWith('SPIKE') || feed.type.startsWith('ZERO') ? 'var(--primary-rose)' : '#f43f5e' }}>
                                      {feed.type.startsWith('SURGE_COST') ? '⚡ 예산 급증 감지' 
                                       : feed.type.startsWith('SURGE_PURCHASE') ? '⚡ 구매 전환수 폭발'
                                       : feed.type.startsWith('SURGE_ROAS') ? '⚡ 광고 수익률(ROAS) 급증'
                                       : feed.type.startsWith('SPIKE') ? '⚡ 트래픽 급증 감지' 
                                       : feed.type.startsWith('ZERO_PURCHASE') ? '⚠️ 일일 구매 완료 0건 위기'
                                       : '⚠️ 지표 급감 (소진 위기)'}
                                    </span>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{feed.name}</span>
                                  </div>
                                  <div dangerouslySetInnerHTML={{ __html: feed.message }} style={{ color: 'var(--text-primary)' }}></div>
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
                                <div key={i} style={{
                                  background: feed.type === 'TRAFFIC_GROWTH' ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)',
                                  borderLeft: '4px solid',
                                  borderLeftColor: feed.type === 'TRAFFIC_GROWTH' ? 'var(--primary-emerald)' : '#ef4444',
                                  padding: '12px 16px',
                                  borderRadius: '0 8px 8px 0',
                                  fontSize: '0.82rem',
                                  lineHeight: '1.5'
                                }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <span style={{ fontWeight: 700, color: feed.type === 'TRAFFIC_GROWTH' ? 'var(--primary-emerald)' : '#ef4444' }}>
                                      {feed.type === 'TRAFFIC_GROWTH' ? '🔺 트래픽 활성화' : '🔻 트래픽 하락 추세'}
                                    </span>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{feed.name}</span>
                                  </div>
                                  <div dangerouslySetInnerHTML={{ __html: feed.message }} style={{ color: 'var(--text-primary)' }}></div>
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
                                    <td style={{ fontWeight: 600, color: 'var(--primary-rose)' }}>{formatNumber(camp.sales_amt)}원</td>
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
                                                                            <span className={`badge ${suba.ad_status.toLowerCase()}`} style={{ fontSize: '0.6rem', padding: '1px 4px' }}>
                                                                              {suba.ad_status === 'ELIGIBLE' ? '노출가능' : '노출제한'}
                                                                            </span>
                                                                            <span style={{ fontSize: '0.6rem', color: suba.inspect_status === 'APPROVED' ? 'var(--primary-emerald)' : 'var(--text-secondary)' }}>
                                                                              {suba.inspect_status === 'APPROVED' ? '승인' : suba.inspect_status}
                                                                            </span>
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
                                        <span className={`badge ${adItem.ad_status.toLowerCase()}`} style={{ padding: '2px 6px', fontSize: '0.65rem' }}>
                                          {adItem.ad_status === 'ELIGIBLE' ? '노출가능' : '노출제한'}
                                        </span>
                                        <span style={{ fontSize: '0.65rem', color: adItem.inspect_status === 'APPROVED' ? 'var(--primary-emerald)' : 'var(--text-secondary)' }}>
                                          {adItem.inspect_status === 'APPROVED' ? '승인완료' : adItem.inspect_status}
                                        </span>
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
          <div className="empty-view glass-panel" style={{ flexGrow: 1 }}>
            <div className="empty-icon">👈</div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 600 }}>광고주 계정을 선택해 주세요.</h2>
            <p className="empty-text">사이드바에서 조회할 광고주 계정을 클릭하면 실시간 데이터가 자동으로 로드됩니다.</p>
          </div>
        )}
      </main>

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

      {/* 글로벌 스타일 오버레이 모달 */}
      <style jsx global>{`
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
