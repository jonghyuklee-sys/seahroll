document.addEventListener('DOMContentLoaded', () => {
    // --- State Management ---
    let allDesigns = [];
    let firebaseDesigns = [];
    let currentEditingId = null;
    let selectedItem = null;
    let currentFilter = 'all';
    let currentSort = 'code_asc';
    let favorites = JSON.parse(localStorage.getItem('seahFavorites') || '[]');
    let currentPage = 1;
    let filteredData = [];
    const itemsPerPage = 9;
    let currentImageIndex = 0; // 상세보기 갤러리 인덱스
    let storageImageCache = {}; // rawColorCode -> [url1, url2, ...]
    let storageLoaded = false;
    let isLoadingStorage = false; // 중복 로딩 방지용 플래그

    // --- DOM Elements ---
    const rollGrid = document.getElementById('rollGrid');
    const searchInput = document.getElementById('searchInput');
    const totalCount = document.getElementById('totalCount');
    const themeToggle = document.getElementById('themeToggle');
    const sortSelect = document.getElementById('sortSelect');
    const filterBtns = document.querySelectorAll('.filter-btn');

    // Auth Elements
    const authOverlay = document.getElementById('authOverlay');
    const authPassword = document.getElementById('authPassword');
    const authBtn = document.getElementById('authBtn');
    const DEFAULT_PASS = "2026";

    // Modal Elements
    const modal = document.getElementById('imageModal');
    const closeModal = document.querySelector('.close-modal');
    const modalImage = document.getElementById('modalImage');
    const modalTitle = document.getElementById('modalTitle');
    const modalDesc = document.getElementById('modalDesc');
    const magnifierArea = document.getElementById('magnifierArea');
    const magnifierLens = document.getElementById('magnifierLens');

    // Info elements
    const vSlots = {
        v2ccl1: document.getElementById('v2ccl1'),
        v2ccl2: document.getElementById('v2ccl2'),
        v2ccl3: document.getElementById('v2ccl3'),
        v2ccl4: document.getElementById('v2ccl4'),
        v3ccl1: document.getElementById('v3ccl1'),
        v3ccl2: document.getElementById('v3ccl2'),
        v3ccl3: document.getElementById('v3ccl3'),
        v3ccl4: document.getElementById('v3ccl4'),
        vRemarks: document.getElementById('vRemarks')
    };

    // Action buttons
    const editBtn = document.getElementById('editBtn');
    const deleteBtn = document.getElementById('deleteBtn');

    // Add Modal Elements
    const addDesignBtn = document.getElementById('addDesignBtn');
    const addModal = document.getElementById('addDesignModal'); // ID 수정 완료
    const closeAddModal = document.querySelector('.close-add-modal');
    const addDesignForm = document.getElementById('addDesignForm');
    const fileUploadBox = document.getElementById('fileUploadBox');
    const fileInput = document.getElementById('add_image');
    const filePreview = document.getElementById('filePreview');
    const submitBtn = document.getElementById('submitBtn');
    const addModalTitle = addModal ? addModal.querySelector('h2') : null;

    // --- Authentication ---
    function checkAuth() {
        if (authPassword.value === DEFAULT_PASS) {
            sessionStorage.setItem('seahAuth', 'true');
            authOverlay.style.display = 'none';
            if (typeof initializeDesigns === 'function') {
                initializeDesigns();
            }
        } else {
            alert('비밀번호가 올바르지 않습니다.');
            authPassword.value = '';
            authPassword.focus();
        }
    }

    // Init state check
    if (sessionStorage.getItem('seahAuth') === 'true') {
        authOverlay.style.display = 'none';
        initializeDesigns();
    } else {
        authOverlay.style.display = 'flex';
        authPassword.focus();
    }

    authBtn.onclick = checkAuth;
    authPassword.onkeypress = (e) => { if (e.key === 'Enter') checkAuth(); };

    // --- Theme Control ---
    const savedTheme = localStorage.getItem('seahTheme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);

    themeToggle.onclick = () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('seahTheme', next);
        updateThemeIcon(next);
    };

    function updateThemeIcon(theme) {
        const icon = themeToggle.querySelector('i');
        icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }

    // --- Data Management ---
    function normalizeCode(code) {
        if (!code) return "";
        // 1. 공백 제거 및 대문자화
        let str = code.toString().toUpperCase().replace(/\s/g, '');
        // 2. 핵심 번호만 추출 (예: I001 -> I001, [1001] -> 1001)
        // 만약 [ ] 가 있다면 그 안의 내용만 사용
        const bracketMatch = str.match(/\[([^\]]+)\]/);
        if (bracketMatch) str = bracketMatch[1];

        return str.replace(/[^A-Z0-9]/g, '');
    }

    function getDigits(str) {
        return str.replace(/[^0-9]/g, '');
    }

    function formatColorCode(code) {
        if (!code) return "";
        let cleanCode = code.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
        const parts = cleanCode.split(' ');
        if (parts.length > 1) {
            const prefixFullMatch = parts[0].match(/^([A-Za-z]+)(\d+)$/);
            if (prefixFullMatch) {
                const prefix = prefixFullMatch[1];
                let isTargetPattern = true;
                for (let i = 1; i < parts.length; i++) {
                    if (!/^\d+$/.test(parts[i]) && parts[i] !== prefix + parts[i].replace(prefix, '')) {
                        isTargetPattern = false;
                        break;
                    }
                }
                if (isTargetPattern) {
                    return parts.map((part, index) => (index > 0 && /^\d+$/.test(part) ? prefix + part : part)).join(', ');
                }
            }
        }
        return code;
    }

    // --- Storage 이미지 로딩 (지정된 코드들을 최우선 스캔) ---
    async function loadStorageImages(prioritizeCodes = []) {
        // 이미 진행 중이면 중단하지 않되, 우선순위 코드가 있으면 특별 처리
        if (isLoadingStorage && prioritizeCodes.length === 0) return;

        try {
            const rootRef = storage.ref('roll_designs');

            // 1. 최우선 순위 코드들 먼저 스캔 (현재 화면에 보이는 10개)
            if (prioritizeCodes.length > 0) {
                console.log(`⚡ 우선순위 스캔 시작: ${prioritizeCodes.join(', ')}`);
                await Promise.all(prioritizeCodes.map(async (code) => {
                    if (storageImageCache[code] && storageImageCache[code].length > 0) return;

                    try {
                        const folderRef = storage.ref(`roll_designs/[${code}]`);
                        const filesResult = await folderRef.listAll();
                        const imageFiles = filesResult.items.filter(item =>
                            /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(item.name)
                        );

                        if (imageFiles.length > 0) {
                            const urls = await Promise.all(
                                imageFiles.map(item => item.getDownloadURL().catch(() => null))
                            );
                            const validUrls = urls.filter(Boolean);
                            if (validUrls.length > 0) {
                                storageImageCache[code] = validUrls;
                                // 💡 중요: 다음을 위해 Firestore에 자동 세이브 (인덱싱)
                                const design = firebaseDesigns.find(d => extractCoreCode(d.rawColorCode) === code);
                                if (design && (!design._firestoreUrls || design._firestoreUrls.length === 0)) {
                                    db.collection('rollDesigns').doc(design.id).update({
                                        imageUrls: validUrls,
                                        imageUrl: validUrls[0],
                                        indexedAt: firebase.firestore.FieldValue.serverTimestamp()
                                    }).catch(e => console.warn('Index Sync Error:', e));
                                }
                            }
                        }
                    } catch (e) { /* 폴더가 없으면 패스 */ }
                }));
                mergeStorageAndRender();
            }

            // 2. 전체 백그라운드 스캔 (storageLoaded가 아닐 때만 1회 실행)
            if (storageLoaded || isLoadingStorage) return;
            isLoadingStorage = true;

            console.log('📂 전체 Storage 백그라운드 스캔 시작...');
            const result = await rootRef.listAll();
            const totalFolders = result.prefixes.length;
            let processedFolders = 0;

            const batchSize = 10;
            for (let i = 0; i < result.prefixes.length; i += batchSize) {
                const batch = result.prefixes.slice(i, i + batchSize);
                await Promise.all(batch.map(async (folderRef) => {
                    const folderName = folderRef.name;
                    const match = folderName.match(/^\[([^\]]+)\]/);
                    if (!match) { processedFolders++; return; }

                    const codes = match[1].split(',').map(c => extractCoreCode(c.trim())).filter(c => c !== '');

                    // 이미 캐시되어 있거나 Firestore에 주소가 있는 경우 건너뛰어 속도 향상
                    const needsScan = codes.some(c => !storageImageCache[c]);
                    if (!needsScan) { processedFolders++; return; }

                    try {
                        const filesResult = await folderRef.listAll();
                        const imageFiles = filesResult.items.filter(item => /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(item.name));
                        if (imageFiles.length > 0) {
                            const urls = await Promise.all(imageFiles.map(item => item.getDownloadURL().catch(() => null)));
                            const validUrls = urls.filter(Boolean);
                            if (validUrls.length > 0) {
                                codes.forEach(c => { storageImageCache[c] = validUrls; });
                            }
                        }
                    } catch (e) { }
                    processedFolders++;
                }));

                if (i % 30 === 0) mergeStorageAndRender(); // 중간 중간 갱신
            }

            storageLoaded = true;
            isLoadingStorage = false;
            console.log(`🏁 전체 스캔 완료 (캐시된 코드: ${Object.keys(storageImageCache).length}개)`);
            mergeStorageAndRender();
        } catch (err) {
            isLoadingStorage = false;
            storageLoaded = true;
        }
    }

    // 핵심 코드 추출 함수 (무조건 I + 숫자 3자리 패턴)
    function extractCoreCode(text) {
        if (!text) return '';
        const match = text.match(/I[0-9]{3}/i);
        return match ? match[0].toUpperCase() : '';
    }

    // Firestore 데이터 + Storage 이미지 병합 후 렌더링
    function mergeStorageAndRender() {
        allDesigns = firebaseDesigns.map(design => {
            const raw = design.rawColorCode || '';
            const coreF = extractCoreCode(raw);

            // 1. Storage 캐시 확인 우선
            let finalUrls = storageImageCache[coreF] || design._firestoreUrls || [];

            return {
                ...design,
                id: design.id, // ID 명시적 보존
                imageUrls: finalUrls,
                imageUrl: finalUrls.length > 0 ? finalUrls[0] : ''
            };
        });

        applyFiltersAndSort(false);
    }

    // 초기화 및 실시간 감시
    function initializeDesigns() {
        // Firestore 실시간 감시 시작
        db.collection('rollDesigns').onSnapshot(snapshot => {
            console.log(`📡 데이터 실시간 업데이트 감지: ${snapshot.size}개 항목 로드됨`);
            firebaseDesigns = snapshot.docs.map(doc => {
                const data = doc.data();
                if (!data.colorCode) return null;
                const firestoreUrls = data.imageUrls || (data.imageUrl ? [data.imageUrl] : []);
                return {
                    id: doc.id,
                    ...data,
                    rawColorCode: data.colorCode,
                    colorCode: formatColorCode(data.colorCode),
                    _firestoreUrls: firestoreUrls,
                    imageUrls: firestoreUrls,
                    imageUrl: firestoreUrls.length > 0 ? firestoreUrls[0] : '',
                    isLocal: false
                };
            }).filter(item => item !== null);

            if (storageLoaded) {
                // Storage 스캔이 이미 끝났으면 바로 병합
                mergeStorageAndRender();
            } else {
                // Storage 스캔이 아직이면 일단 Firestore 데이터만 먼저 표시
                allDesigns = [...firebaseDesigns];
                applyFiltersAndSort(false);
            }
        }, error => {
            console.error("Firestore Error:", error);
            rollGrid.innerHTML = '<div class="loading">데이터를 불러오는 중 오류가 발생했습니다.</div>';
        });

        // Storage 스캔 시작 (완료 후 무조건 재렌더링)
        loadStorageImages().then(() => {
            console.log('🔄 Storage 스캔 완료 → 화면 재렌더링 시작');
            if (firebaseDesigns.length > 0) {
                mergeStorageAndRender();
            }
        });
    }

    // 초기화 실행
    initializeDesigns();


    function applyFiltersAndSort(resetPage = true) {
        let filtered = [...allDesigns];
        const query = searchInput.value.toLowerCase().trim();

        // 1. Keyword Search
        if (query) {
            filtered = filtered.filter(item => {
                const searchStr = [
                    item.colorCode, item.description,
                    item.line2CCL_1, item.line2CCL_2, item.line2CCL_3, item.line2CCL_4,
                    item.line3CCL_1, item.line3CCL_2, item.line3CCL_3, item.line3CCL_4
                ].filter(Boolean).join(' ').toLowerCase();
                return searchStr.includes(query);
            });
        }

        // 2. Category Filter
        if (currentFilter === 'fav') {
            filtered = filtered.filter(item => favorites.includes(item.colorCode));
        } else if (currentFilter === '2ccl') {
            filtered = filtered.filter(item =>
                item.line2CCL_1 || item.line2CCL_2 || item.line2CCL_3 || item.line2CCL_4
            );
        } else if (currentFilter === '3ccl') {
            filtered = filtered.filter(item =>
                item.line3CCL_1 || item.line3CCL_2 || item.line3CCL_3 || item.line3CCL_4
            );
        }

        // 3. Sorting
        if (currentSort === 'code_asc') {
            filtered.sort((a, b) => (a.colorCode || "").localeCompare(b.colorCode || "", 'ko', { numeric: true }));
        } else if (currentSort === 'code_desc') {
            filtered.sort((a, b) => (b.colorCode || "").localeCompare(a.colorCode || "", 'ko', { numeric: true }));
        } else if (currentSort === 'newest') {
            filtered.sort((a, b) => {
                const getTime = (val) => {
                    if (!val) return 0;
                    if (val.seconds) return val.seconds;
                    return new Date(val).getTime() / 1000;
                };
                return getTime(b.createdAt) - getTime(a.createdAt);
            });
        }

        // 4. 사진이 있는 항목을 먼저 보여주기 (2차 정렬)
        filtered.sort((a, b) => {
            const aHasImg = (a.imageUrls && a.imageUrls.length > 0) ? 1 : 0;
            const bHasImg = (b.imageUrls && b.imageUrls.length > 0) ? 1 : 0;
            return bHasImg - aHasImg; // 사진 있는 것이 먼저
        });

        if (resetPage) {
            currentPage = 1;
        }
        renderRolls(filtered);
    }

    const paginationContainer = document.getElementById('pagination');

    // --- UI Rendering ---
    function renderRolls(data) {
        filteredData = data;
        totalCount.textContent = filteredData.length;

        if (filteredData.length === 0) {
            rollGrid.innerHTML = '<div class="loading">검색 결과가 없습니다.</div>';
            paginationContainer.innerHTML = '';
            return;
        }

        // Calculate slice
        const start = (currentPage - 1) * itemsPerPage;
        const end = start + itemsPerPage;
        const pageItems = data.slice(start, end);

        // ⚡ [성능 최적화] 현재 페이지 디자인들 우선 스캔 & 자동 인덱싱
        const codesToScan = pageItems
            .filter(item => !item.imageUrl) // 아직 사진이 없는 것만
            .map(item => extractCoreCode(item.rawColorCode));

        if (codesToScan.length > 0) {
            loadStorageImages(codesToScan);
        }

        rollGrid.innerHTML = '';
        pageItems.forEach(item => {
            const isFav = favorites.includes(item.colorCode);
            const card = document.createElement('div');
            card.className = 'roll-card';
            const ccl2 = [item.line2CCL_1, item.line2CCL_2, item.line2CCL_3, item.line2CCL_4].filter(Boolean).join(' / ');
            const ccl3 = [item.line3CCL_1, item.line3CCL_2, item.line3CCL_3, item.line3CCL_4].filter(Boolean).join(' / ');

            // 사진 목록 분류 (원본 vs 썸네일)
            const allUrls = item.imageUrls || [];
            const thumbUrls = allUrls.filter(u => u.includes('_thumb.jpg') || u.includes('/thumbs/'));
            const originalUrls = allUrls.filter(u => !u.includes('_thumb.jpg') && !u.includes('/thumbs/'));

            // 목록용 썸네일: 있으면 썸네일, 없으면 첫번째 사진
            const thumbUrl = thumbUrls.length > 0 ? thumbUrls[0] : (originalUrls.length > 0 ? originalUrls[0] : null);

            const imageTag = thumbUrl
                ? `<img src="${thumbUrl}" alt="${item.colorCode}" loading="lazy" onload="this.classList.add('loaded'); this.parentElement.classList.remove('loading');" onerror="this.style.display='none'; this.parentElement.classList.remove('loading');">`
                : `<div class="no-image-text">No Image</div>`;

            // 다중 이미지 뱃지 처리 (원본 사진 개수 기준)
            const imageCountBadge = (originalUrls.length > 1)
                ? `<div class="image-count-badge">
                    <i class="fas fa-images"></i> ${originalUrls.length}
                   </div>`
                : '';

            card.innerHTML = `
                <div class="card-img loading">
                    ${imageTag}
                    <button class="fav-btn ${isFav ? 'active' : ''}" data-code="${item.colorCode}">
                        <i class="${isFav ? 'fas' : 'far'} fa-star"></i>
                    </button>
                    ${imageCountBadge}
                </div>
                <div class="card-content">
                    <div class="card-header">
                        <h3 class="card-title">${item.colorCode}</h3>
                        <span class="card-desc">${item.description || ''}</span>
                    </div>
                    <div class="card-codes">
                        <div class="code-row"><span>2CCL:</span> <span class="code-val">${ccl2 || '-'}</span></div>
                        <div class="code-row"><span>3CCL:</span> <span class="code-val">${ccl3 || '-'}</span></div>
                    </div>
                </div>
            `;

            card.querySelector('.fav-btn').onclick = (e) => {
                e.stopPropagation();
                toggleFavorite(item.colorCode);
            };

            // 상세보기에선 원본 목록만 전달하여 선명하게 표시
            const finalModalUrls = originalUrls.length > 0 ? originalUrls : allUrls;
            card.onclick = () => openDetail(item, finalModalUrls);
            rollGrid.appendChild(card);
        });

        renderPagination();
    }

    function renderPagination() {
        const totalPages = Math.ceil(filteredData.length / itemsPerPage);
        paginationContainer.innerHTML = '';

        if (totalPages <= 1) return;

        // Prev Button
        const prevBtn = document.createElement('button');
        prevBtn.className = 'pagination-btn';
        prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
        prevBtn.disabled = currentPage === 1;
        prevBtn.onclick = () => { currentPage--; renderRolls(filteredData); };
        paginationContainer.appendChild(prevBtn);

        // Page Numbers (Smart display)
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, startPage + 4);
        if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);

        if (startPage > 1) {
            paginationContainer.appendChild(createPageBtn(1));
            if (startPage > 2) {
                const dot = document.createElement('span');
                dot.className = 'pagination-ellipsis';
                dot.textContent = '...';
                paginationContainer.appendChild(dot);
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            paginationContainer.appendChild(createPageBtn(i));
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                const dot = document.createElement('span');
                dot.className = 'pagination-ellipsis';
                dot.textContent = '...';
                paginationContainer.appendChild(dot);
            }
            paginationContainer.appendChild(createPageBtn(totalPages));
        }

        // Next Button
        const nextBtn = document.createElement('button');
        nextBtn.className = 'pagination-btn';
        nextBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
        nextBtn.disabled = currentPage === totalPages;
        nextBtn.onclick = () => { currentPage++; renderRolls(filteredData); };
        paginationContainer.appendChild(nextBtn);
    }

    function createPageBtn(page) {
        const btn = document.createElement('button');
        btn.className = `pagination-btn ${currentPage === page ? 'active' : ''}`;
        btn.textContent = page;
        btn.onclick = () => { currentPage = page; renderRolls(filteredData); };
        return btn;
    }

    function toggleFavorite(code) {
        if (favorites.includes(code)) {
            favorites = favorites.filter(f => f !== code);
        } else {
            favorites.push(code);
        }
        localStorage.setItem('seahFavorites', JSON.stringify(favorites));
        applyFiltersAndSort();
    }

    // --- Lazy Loading Logic ---
    const lazyObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const el = entry.target;
                const src = el.dataset.src;
                if (src) {
                    const img = new Image();
                    img.src = src;
                    img.onload = () => {
                        const imgTag = document.createElement('img');
                        imgTag.src = src;
                        imgTag.alt = "Roll Design";
                        el.appendChild(imgTag);
                        el.classList.add('loaded');
                        const loader = el.querySelector('.loader');
                        if (loader) loader.remove();
                    };
                    img.onerror = () => {
                        el.classList.add('loaded');
                        const loader = el.querySelector('.loader');
                        if (loader) loader.remove();
                        el.innerHTML += '<div style="color:var(--text-muted);font-size:0.8rem;font-weight:700;">No Image</div>';
                    };
                } else {
                    el.classList.add('loaded');
                    const loader = el.querySelector('.loader');
                    if (loader) loader.remove();
                    el.innerHTML += '<div style="color:var(--text-muted);font-size:0.8rem;font-weight:700;">No Image</div>';
                }
                observer.unobserve(el);
            }
        });
    }, { rootMargin: '400px' });

    function initLazyLoading() {
        document.querySelectorAll('.lazy-img').forEach(el => lazyObserver.observe(el));
    }

    // --- Detail View Logic ---
    function openDetail(item) {
        selectedItem = item;
        currentImageIndex = 0;
        const images = item.imageUrls && item.imageUrls.length > 0 ? item.imageUrls : (item.imageUrl ? [item.imageUrl] : []);

        // 현재 이미지 표시
        const currentUrl = images.length > 0 ? images[0] : '';
        modalImage.src = currentUrl;
        modalTitle.textContent = item.colorCode;
        modalDesc.textContent = item.description || "";

        const slots = {
            line2CCL_1: 'v2ccl1', line2CCL_2: 'v2ccl2', line2CCL_3: 'v2ccl3', line2CCL_4: 'v2ccl4',
            line3CCL_1: 'v3ccl1', line3CCL_2: 'v3ccl2', line3CCL_3: 'v3ccl3', line3CCL_4: 'v3ccl4',
            remarks: 'vRemarks'
        };
        for (let key in slots) {
            const el = document.getElementById(slots[key]);
            if (el) el.textContent = item[key] || '-';
        }

        // 갤러리 네비게이션 UI 구성
        setupGalleryNav(images);

        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        magnifierLens.style.backgroundImage = `url('${currentUrl}')`;
    }

    // --- Gallery Navigation in Detail Modal ---
    function setupGalleryNav(images) {
        // 기존 네비게이션 요소 제거
        const existingNav = magnifierArea.querySelector('.gallery-nav');
        if (existingNav) existingNav.remove();
        const existingCounter = magnifierArea.querySelector('.gallery-counter');
        if (existingCounter) existingCounter.remove();
        const existingThumbs = document.querySelector('.gallery-thumbnails');
        if (existingThumbs) existingThumbs.remove();

        if (images.length <= 1) return; // 1장 이하면 네비 불필요

        // 이미지 카운터
        const counter = document.createElement('div');
        counter.className = 'gallery-counter';
        counter.id = 'galleryCounter';
        counter.textContent = `1 / ${images.length}`;
        magnifierArea.appendChild(counter);

        // 좌우 화살표
        const nav = document.createElement('div');
        nav.className = 'gallery-nav';
        nav.innerHTML = `
            <button class="gallery-nav-btn gallery-prev" id="galleryPrev"><i class="fas fa-chevron-left"></i></button>
            <button class="gallery-nav-btn gallery-next" id="galleryNext"><i class="fas fa-chevron-right"></i></button>
        `;
        magnifierArea.appendChild(nav);

        // 썸네일 바 (info-panel 상단에 추가)
        const infoPanel = modal.querySelector('.info-panel');
        const thumbBar = document.createElement('div');
        thumbBar.className = 'gallery-thumbnails';
        images.forEach((url, idx) => {
            const thumb = document.createElement('div');
            thumb.className = `gallery-thumb ${idx === 0 ? 'active' : ''}`;
            thumb.innerHTML = `<img src="${url}" alt="사진 ${idx + 1}">`;
            thumb.onclick = () => {
                currentImageIndex = idx;
                updateGalleryImage(images);
            };
            thumbBar.appendChild(thumb);
        });
        // info-header 바로 뒤에 삽입
        const infoHeader = infoPanel.querySelector('.info-header');
        infoHeader.insertAdjacentElement('afterend', thumbBar);

        // 이벤트 바인딩
        document.getElementById('galleryPrev').onclick = (e) => {
            e.stopPropagation();
            currentImageIndex = (currentImageIndex - 1 + images.length) % images.length;
            updateGalleryImage(images);
        };
        document.getElementById('galleryNext').onclick = (e) => {
            e.stopPropagation();
            currentImageIndex = (currentImageIndex + 1) % images.length;
            updateGalleryImage(images);
        };
    }

    function updateGalleryImage(images) {
        const url = images[currentImageIndex];
        modalImage.src = url;
        magnifierLens.style.backgroundImage = `url('${url}')`;

        // 카운터 업데이트
        const counter = document.getElementById('galleryCounter');
        if (counter) counter.textContent = `${currentImageIndex + 1} / ${images.length}`;

        // 썸네일 활성 상태 업데이트
        document.querySelectorAll('.gallery-thumb').forEach((thumb, idx) => {
            thumb.classList.toggle('active', idx === currentImageIndex);
        });
    }

    // --- Magnifier View Logic ---
    magnifierArea.onmousemove = (e) => {
        if (!selectedItem || !modalImage.src) return;
        const rect = modalImage.getBoundingClientRect();
        const areaRect = magnifierArea.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (x > 0 && x < rect.width && y > 0 && y < rect.height) {
            magnifierLens.style.display = 'block';
            const zoom = 2.5;
            const lensW = magnifierLens.offsetWidth / 2;
            const lensH = magnifierLens.offsetHeight / 2;

            // 이미지 내 마우스 위치에 따라 렌즈 위치 계산
            magnifierLens.style.left = (e.clientX - areaRect.left - lensW) + "px";
            magnifierLens.style.top = (e.clientY - areaRect.top - lensH) + "px";

            // 배경 이미지 확대 및 위치 조정
            magnifierLens.style.backgroundSize = (rect.width * zoom) + "px " + (rect.height * zoom) + "px";
            magnifierLens.style.backgroundPosition = "-" + ((x * zoom) - lensW) + "px -" + ((y * zoom) - lensH) + "px";
        } else {
            magnifierLens.style.display = 'none';
        }
    };
    magnifierArea.onmouseleave = () => { magnifierLens.style.display = 'none'; };

    // --- Gallery Modal Function ---
    window.showGalleryModal = function (item) {
        let gModal = document.getElementById('galleryModal');
        if (!gModal) {
            gModal = document.createElement('div');
            gModal.id = 'galleryModal';
            gModal.className = 'gallery-modal';
            document.body.appendChild(gModal);
        }
        const images = item.imageUrls || [item.imageUrl];
        gModal.innerHTML = `
            <div class="gallery-content">
                <span class="close-gallery">&times;</span>
                <div class="gallery-header">
                    <h2>[${item.colorCode}] ${item.description || ''}</h2>
                    <p>전체 사진 ${images.length}장</p>
                </div>
                <div class="gallery-list">
                    ${images.map((url, idx) => `
                        <div class="gallery-item" onclick="window.showInMainModal('${url}')">
                            <img src="${url}" alt="${item.colorCode}_${idx}" loading="lazy">
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        gModal.style.display = 'flex';
        gModal.querySelector('.close-gallery').onclick = () => { gModal.style.display = 'none'; };
        gModal.onclick = (e) => { if (e.target === gModal) gModal.style.display = 'none'; };
    };

    window.showInMainModal = function (url) {
        modalImage.src = url;
        magnifierLens.style.backgroundImage = `url('${url}')`;
        document.getElementById('galleryModal').style.display = 'none';
        modal.style.display = 'flex';
    };

    // --- Global Event Listeners ---
    searchInput.oninput = () => {
        currentPage = 1;
        applyFiltersAndSort();
    };

    sortSelect.onchange = (e) => {
        currentSort = e.target.value;
        currentPage = 1;
        applyFiltersAndSort();
    };

    filterBtns.forEach(btn => {
        btn.onclick = () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.id.replace('filter', '').toLowerCase();
            currentPage = 1;
            applyFiltersAndSort();
        };
    });

    closeModal.onclick = () => { modal.style.display = 'none'; document.body.style.overflow = ''; };

    if (addDesignBtn) {
        addDesignBtn.onclick = () => {
            selectedItem = null;
            addModalTitle.textContent = '신규 디자인 등록';
            addDesignForm.reset();
            filePreview.style.display = 'none';
            addModal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            filePreview.innerHTML = ''; // 기존 미리보기 초기화
            currentEditPhotos = [];
            fileInput.value = '';
        };
    }

    // --- File Upload Logic ---
    if (fileUploadBox) {
        fileUploadBox.onclick = () => fileInput.click();
    }

    let currentEditPhotos = []; // 수정 중인 사진 목록을 담는 변수

    function renderEditPhotos() {
        filePreview.innerHTML = '';
        filePreview.style.display = 'flex';
        filePreview.style.flexWrap = 'wrap';
        filePreview.style.gap = '10px';

        currentEditPhotos.forEach((url, index) => {
            const container = document.createElement('div');
            container.style.position = 'relative';
            container.style.width = '80px';
            container.style.height = '80px';

            const img = document.createElement('img');
            img.src = url;
            img.style.cssText = 'width: 100%; height: 100%; object-fit: cover; border-radius: 8px; border: 2px solid #ddd;';

            const delBtn = document.createElement('button');
            delBtn.innerHTML = '×';
            delBtn.style.cssText = 'position: absolute; top: -8px; right: -8px; background: #ff4d4d; color: #fff; border: none; border-radius: 50%; width: 22px; height: 22px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.2); z-index: 10;';
            delBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                currentEditPhotos.splice(index, 1);
                renderEditPhotos();
            };

            container.appendChild(img);
            container.appendChild(delBtn);
            filePreview.appendChild(container);
        });
    }

    fileInput.onchange = (e) => {
        const files = e.target.files;
        // 기존 사진들 뒤에 새로운 사진 미리보기 추가 (파일 객체 자체를 미리보기로 표시)
        if (files.length > 0) {
            filePreview.style.display = 'flex';
            Array.from(files).forEach(file => {
                const reader = new FileReader();
                reader.onload = (re) => {
                    const container = document.createElement('div');
                    container.style.position = 'relative';
                    container.style.width = '80px';
                    container.style.height = '80px';

                    const img = document.createElement('img');
                    img.src = re.target.result;
                    img.style.cssText = 'width: 100%; height: 100%; object-fit: cover; border-radius: 8px; border: 2px solid var(--primary);';

                    const badge = document.createElement('div');
                    badge.innerHTML = 'NEW';
                    badge.style.cssText = 'position: absolute; bottom: -5px; right: -5px; background: var(--primary); color: #fff; font-size: 8px; padding: 2px 4px; border-radius: 4px; font-weight: bold;';

                    container.appendChild(img);
                    container.appendChild(badge);
                    filePreview.appendChild(container);
                };
                reader.readAsDataURL(file);
            });
        }
    };

    if (closeAddModal) {
        closeAddModal.onclick = () => {
            addModal.style.display = 'none';
            document.body.style.overflow = '';
            fileInput.value = ''; // 닫을 때 파일 선택 취소
            currentEditPhotos = [];
        };
    }

    // 🖼️ 브라우저에서 이미지 리사이징 (Canvas API)
    function resizeImage(file, maxSize = 1200) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let w = img.width, h = img.height;
                    if (w > h) {
                        if (w > maxSize) { h = h * (maxSize / w); w = maxSize; }
                    } else {
                        if (h > maxSize) { w = w * (maxSize / h); h = maxSize; }
                    }
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    submitBtn.onclick = async (e) => {
        e.preventDefault();
        const colorCode = document.getElementById('add_colorCode').value;
        const description = document.getElementById('add_description').value;
        if (!colorCode) return alert('컬러코드는 필수 입력 사항입니다.');

        submitBtn.disabled = true;
        submitBtn.textContent = '저장 중...';
        // 데이터 객체 구성
        const data = {
            colorCode: colorCode,
            description: document.getElementById('add_description').value,
            line2CCL_1: document.getElementById('add_2ccl1').value,
            line2CCL_2: document.getElementById('add_2ccl2').value,
            line2CCL_3: document.getElementById('add_2ccl3').value,
            line2CCL_4: document.getElementById('add_2ccl4').value,
            line3CCL_1: document.getElementById('add_3ccl1').value,
            line3CCL_2: document.getElementById('add_3ccl2').value,
            line3CCL_3: document.getElementById('add_3ccl3').value,
            line3CCL_4: document.getElementById('add_3ccl4').value,
            remarks: document.getElementById('add_remarks').value,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            const files = Array.from(fileInput.files); // Use fileInput from the original context
            let urls = [];

            if (files.length > 0) {
                // 병렬 업로드로 속도 개선
                const uploadPromises = files.map(async (file) => {
                    const resizedBlob = await resizeImage(file); // Resize the image
                    const fileName = `${Date.now()}_${file.name.replace(/\.[^/.]+$/, "")}.jpg`; // New file naming
                    const folderPath = `roll_designs/[${colorCode}]/${fileName}`; // Use new file name in path
                    const ref = storage.ref(folderPath);
                    const snap = await ref.put(resizedBlob); // Upload the resized blob
                    return await snap.ref.getDownloadURL();
                });
                urls = await Promise.all(uploadPromises);
            }

            // 이미지 데이터 업데이트 (기존 유지된 사진 + 신규 업로드 사진)
            const finalUrls = [...currentEditPhotos, ...urls];

            data.imageUrls = finalUrls;
            data.imageUrl = finalUrls.length > 0 ? finalUrls[0] : '';

            if (selectedItem && selectedItem.id && addModalTitle.textContent === '정보 수정') {
                // update를 사용해야 배열 필드가 의도대로 덮어씌워집니다.
                await db.collection('rollDesigns').doc(selectedItem.id).update(data);
            } else {
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await db.collection('rollDesigns').add(data);
            }

            alert('성공적으로 저장되었습니다!');
            fileInput.value = ''; // 파일 입력 초기화
            currentEditPhotos = [];
            addModal.style.display = 'none';
        } catch (error) {
            console.error('Save error:', error);
            alert('저장 중 오류가 발생했습니다: ' + error.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = '데이터 저장하기';
        }
    };

    editBtn.onclick = () => {
        if (!selectedItem) return;
        addModalTitle.textContent = '정보 수정';
        const fields = ['colorCode', 'description', '2ccl1', '2ccl2', '2ccl3', '2ccl4', '3ccl1', '3ccl2', '3ccl3', '3ccl4', 'remarks'];
        fields.forEach(f => {
            const el = document.getElementById('add_' + f);
            const key = f.includes('ccl') ? 'line' + f.toUpperCase().replace('CCL', 'CCL_') : f;
            el.value = selectedItem[key] || '';
        });

        // 기존 사진들 불러오기
        currentEditPhotos = selectedItem.imageUrls ? [...selectedItem.imageUrls] : (selectedItem.imageUrl ? [selectedItem.imageUrl] : []);
        renderEditPhotos();

        modal.style.display = 'none';
        addModal.style.display = 'flex';
    };

    // 삭제 버튼 클릭 시 처리
    deleteBtn.onclick = async () => {
        if (!selectedItem || !selectedItem.id) return alert('삭제할 항목을 선택해주세요.');
        if (!confirm(`'${selectedItem.colorCode}' 디자인을 정말 삭제하시겠습니까?`)) return;

        deleteBtn.disabled = true;
        deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 삭제 중...';

        try {
            await db.collection('rollDesigns').doc(selectedItem.id).delete();

            // 🔥 화면 즉시 반영 (전체 리스트에서 제거)
            firebaseDesigns = firebaseDesigns.filter(d => d.id !== selectedItem.id);
            allDesigns = allDesigns.filter(d => d.id !== selectedItem.id);

            alert('삭제되었습니다!');

            modal.style.display = 'none';
            document.body.style.overflow = '';
            selectedItem = null;

            // 필터 및 렌더링 호출
            applyFiltersAndSort(false);
        } catch (error) {
            console.error('Delete error:', error);
            alert('삭제 중 오류가 발생했습니다: ' + error.message);
        } finally {
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = '<i class="fas fa-trash"></i> 삭제';
        }
    };

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            [modal, addModal, document.getElementById('galleryModal')].forEach(m => { if (m) m.style.display = 'none'; });
            document.body.style.overflow = '';
        }
    });

    if (sessionStorage.getItem('seahAuth') === 'true') {
        authOverlay.style.display = 'none';
        initializeDesigns();
    }
});
