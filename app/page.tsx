'use client';

import { useState, useEffect, Fragment } from 'react';
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

type DatePreset = 'yesterday' | 'last7days' | 'last30days' | 'lastweek' | 'lastmonth' | 'custom';
type SortKey = 'campaign_name' | 'adgroup_name' | 'ad_name' | 'imp_cnt' | 'clk_cnt' | 'ctr' | 'cpc' | 'sales_amt' | 'ccnt' | 'conv_amt' | 'ror';
type SortOrder = 'asc' | 'desc';

export default function Dashboard() {
  const [accounts, setAccounts] = useState<AdvertiserAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [campaigns, setCampaigns] = useState<CampaignStat[]>([]);
  const [adgroups, setAdgroups] = useState<AdGroupStat[]>([]);
  const [ads, setAds] = useState<AdStat[]>([]);
  
  // 마스터 이름 캐시 맵 (날짜 무관 백업 조회용)
  const [campaignMasterNames, setCampaignMasterNames] = useState<Map<string, string>>(new Map());
  const [adgroupMasterNames, setAdgroupMasterNames] = useState<Map<string, string>>(new Map());
  
  // 탭 제어 상태 ('campaign' | 'adgroup' | 'ad')
  const [activeTab, setActiveTab] = useState<'campaign' | 'adgroup' | 'ad'>('campaign');
  
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

  // 1. 광고주 계정 목록 조회 (Supabase)
  const fetchAccounts = async () => {
    try {
      setLoadingAccounts(true);
      const { data, error } = await supabase
        .from('advertiser_accounts')
        .select('*')
        .order('ad_account_name', { ascending: true });

      if (error) throw error;
      setAccounts(data || []);
    } catch (err: any) {
      console.error('Error fetching accounts:', err.message);
    } finally {
      setLoadingAccounts(false);
    }
  };

  // 2-0. Supabase 1,000개 기본 페이지네이션 제한 우회용 전체 데이터 병렬 조회 헬퍼 (결과 보장을 위한 결정적 정렬 추가)
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

  // 2-0-1. Supabase 마스터 이름 조회용 전체 페이지네이션 헬퍼 (결과 보장을 위한 결정적 정렬 추가)
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
    if (!customerId) return;
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
    if (!customerId) return;
    try {
      setLoadingCampaigns(true);
      setLoadingAdgroups(true);
      setLoadingAds(true);
      
      // DB에서 지정 날짜 범위로 데이터 병렬 조회 (페이지네이션 및 결정적 정렬 적용)
      const [campData, adgData, adData] = await Promise.all([
        supabaseFetchAll('campaign_stats', customerId, since, until),
        supabaseFetchAll('adgroup_stats', customerId, since, until),
        supabaseFetchAll('ad_stats', customerId, since, until)
      ]);

      // 며칠간의 데이터가 필요한지 기대치 계산
      const startDate = new Date(since);
      const endDate = new Date(until);
      const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
      const expectedDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

      // DB에 현재 존재하는 고유 날짜 수 계산
      const distinctDatesInDb = new Set(campData.map(row => row.date)).size;

      // DB에 이 기간의 데이터가 아예 존재하지 않거나 불완전하게 적재된 경우 네이버 API 동기화 가동
      if ((campData.length === 0 || adgData.length === 0 || distinctDatesInDb < expectedDays) && forceSyncIfEmpty) {
        console.log(`[Dashboard] DB 내 해당 기간(${since} ~ ${until})의 데이터가 불완전함 (가져온 날짜 수: ${distinctDatesInDb}/${expectedDays}일). 실시간 동기화...`);
        await handleSyncCampaigns(customerId);
      } else {
        aggregateAndSetCampaigns(campData);
        aggregateAndSetAdgroups(adgData);
        aggregateAndSetAds(adData);
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
    try {
      setSyncingAccounts(true);
      const response = await fetch('/api/sync/accounts', { method: 'POST' });
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
    if (!customerId) return;
    try {
      setSyncingCampaigns(true);
      let url = `/api/sync/campaigns?customerId=${customerId}`;
      if (datePreset === 'custom') {
        url += `&since=${since}&until=${until}`;
      } else {
        url += `&datePreset=${datePreset}`;
      }
      const response = await fetch(url, { method: 'POST' });
      const result = await response.json();
      
      if (result.success) {
        // 동기화 완료 후 DB에서 다시 범위 데이터 쿼리 및 마스터 이름 정보 비동기 갱신
        const [campData, adgData, adData] = await Promise.all([
          supabaseFetchAll('campaign_stats', customerId, since, until),
          supabaseFetchAll('adgroup_stats', customerId, since, until),
          supabaseFetchAll('ad_stats', customerId, since, until)
        ]);

        // 마스터 이름 캐시 최신화 (동기화 완료 후 비동기 호출)
        fetchMasterNames(customerId);

        aggregateAndSetCampaigns(campData);
        aggregateAndSetAdgroups(adgData);
        aggregateAndSetAds(adData);
        
        // 광고주 리스트의 갱신 시각 업데이트
        const { data: updatedAccs } = await supabase
          .from('advertiser_accounts')
          .select('*')
          .order('ad_account_name', { ascending: true });
        if (updatedAccs) setAccounts(updatedAccs);
        
      } else {
        alert(`캠페인, 광고그룹, 소재 동기화 실패: ${result.error}`);
      }
    } catch (err: any) {
      alert(`동기화 중 오류 발생: ${err.message}`);
    } finally {
      setSyncingCampaigns(false);
    }
  };

  // 초기 렌더링 시 계정 목록 로드 및 KST 어제 날짜 초기화
  useEffect(() => {
    fetchAccounts();

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

  // 선택된 계정이 바뀔 때만 마스터 이름 캐시 로드 (성능 최적화: 날짜 변경 시 불필요한 대용량 마스터 이름 쿼리 방지)
  useEffect(() => {
    if (selectedAccountId) {
      fetchMasterNames(selectedAccountId);
    } else {
      setCampaignMasterNames(new Map());
      setAdgroupMasterNames(new Map());
    }
  }, [selectedAccountId]);

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

  const activeAccount = accounts.find(acc => acc.customer_id === selectedAccountId);

  // 광고주 검색 필터
  const filteredAccounts = accounts.filter(acc => {
    const term = accountSearchTerm.toLowerCase();
    return (
      acc.ad_account_name.toLowerCase().includes(term) ||
      acc.customer_id.includes(term)
    );
  });

  // 종합 통계 집계 계산 (기존과 동일하게 유지하되, UI에 구매완료가 중심이 되도록 지원)
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
  const overallRoas = summary.totalCost > 0 ? (summary.totalConvAmt / summary.totalCost) * 100 : 0;
  const purchaseRoas = summary.totalCost > 0 ? (summary.totalPurchaseConvAmt / summary.totalCost) * 100 : 0;
  const avgCpa = summary.totalCcnt > 0 ? Math.round(summary.totalCost / summary.totalCcnt) : 0;
  const avgPurchaseCpa = summary.totalPurchaseCcnt > 0 ? Math.round(summary.totalCost / summary.totalPurchaseCcnt) : 0;

  // 캠페인 이름 검색 및 소팅 적용
  const filteredCampaigns = campaigns
    .filter(camp => camp.campaign_name.toLowerCase().includes(campaignSearchTerm.toLowerCase()))
    .sort((a, b) => {
      // 캠페인에 존재하는 키로 안전하게 좁히기
      const sKey = (sortKey === 'adgroup_name' || sortKey === 'ad_name' ? 'campaign_name' : sortKey) as keyof CampaignStat;
      const aVal = a[sKey];
      const bVal = b[sKey];

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
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
      // 광고그룹에 존재하는 키로 안전하게 좁히기
      const sKey = (sortKey === 'campaign_name' || sortKey === 'ad_name' ? 'adgroup_name' : sortKey) as keyof AdGroupStat;
      const aVal = a[sKey];
      const bVal = b[sKey];

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
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
      // 소재에 존재하는 키로 안전하게 좁히기
      const sKey = (sortKey === 'campaign_name' || sortKey === 'adgroup_name' ? 'ad_name' : sortKey) as keyof AdStat;
      const aVal = a[sKey];
      const bVal = b[sKey];

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
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

  return (
    <div className="dashboard-container">
      {/* 1. 사이드바 - 광고주 목록 */}
      <aside className="sidebar">
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
          <div className="logo-section">
            <div className="logo-icon">N</div>
            <div className="logo-text">Premium Adboard</div>
          </div>
          
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
                  onClick={() => setSelectedAccountId(acc.customer_id)}
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

        <button
          className="btn-premium"
          onClick={handleSyncAccounts}
          disabled={syncingAccounts}
          style={{ width: '100%', marginTop: 'auto' }}
        >
          {syncingAccounts ? (
            <>
              <div className="spinner"></div>
              <span>광고주 동기화 중...</span>
            </>
          ) : (
            <span>🔄 Naver 광고주 목록 갱신</span>
          )}
        </button>
      </aside>

      {/* 2. 메인 패널 */}
      <main className="main-content">
        {/* 헤더 */}
        <header className="dashboard-header">
          <div className="title-group">
            <h1 className="dashboard-title">
              {activeAccount ? `${activeAccount.ad_account_name} 성과분석` : '네이버 검색광고 대시보드'}
            </h1>
            <p className="dashboard-subtitle">
              {activeAccount ? `고객 ID: ${activeAccount.customer_id} (권한: ${activeAccount.account_role})` : '왼쪽 사이드바에서 광고주 계정을 선택하세요.'}
            </p>
          </div>
          
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {/* 기간 프리셋 선택 셀렉트 박스 */}
            {selectedAccountId && (
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
            {selectedAccountId && (
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

            <div className="date-badge">
              <span>조회 기준일자</span>
              <strong>{datePreset === 'yesterday' ? since : `${since} ~ ${until}`}</strong>
            </div>
          </div>
        </header>

        {selectedAccountId ? (
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
                  {/* 탭 인터페이스 & CSV 다운로드 버튼 헤더 영역 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
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
                    </div>

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
                  </div>

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
                              // 이 캠페인에 소속된 광고그룹 필터링
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
    </div>
  );
}
