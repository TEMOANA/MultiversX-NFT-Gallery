/**
 * public/js/mvx-nft-public.js
 * Frontend interactivity: masonry grid calculation, client-side sorting, dynamic trait filters, and rarity scoring.
 */

document.addEventListener('DOMContentLoaded', function() {
	// Discover all MultiversX NFT containers on the page
	const containers = document.querySelectorAll('.mvx-nft-container');

	containers.forEach(container => {
		const instanceId = container.getAttribute('data-instance');
		const dataVarName = instanceId + '_data';
		
		// Fetch localized data passed from PHP
		if (typeof window[dataVarName] === 'undefined') {
			console.error(`MultiversX NFT Gallery: Data variable ${dataVarName} not found.`);
			return;
		}

		const config = window[dataVarName];
		console.log("MultiversX Gallery config:", config);
		const rawNfts = config.nfts || [];

		// Decode base64 URLs in raw NFTs data if any exist
		const decodeBase64Uri = (uri) => {
			if (!uri || typeof uri !== 'string') return uri;
			if (uri.includes('://') || uri.startsWith('data:') || uri.startsWith('http')) {
				return uri;
			}
			try {
				const cleaned = uri.trim();
				if (/^[A-Za-z0-9+/=]+$/.test(cleaned)) {
					const decoded = atob(cleaned);
					if (decoded.includes('://') || decoded.startsWith('http')) {
						return decoded;
					}
				}
			} catch (e) {}
			return uri;
		};

		const currentHost = window.location.hostname.replace('www.', '');
		const normalizeLocalUrl = (url) => {
			if (!url || typeof url !== 'string') return url;
			try {
				const parsed = new URL(url);
				const parsedHost = parsed.hostname.replace('www.', '');
				if (parsedHost === currentHost) {
					return window.location.origin + parsed.pathname + parsed.search + parsed.hash;
				}
			} catch (e) {}
			return url;
		};

		rawNfts.forEach(nft => {
			if (nft.image) {
				nft.image = decodeBase64Uri(nft.image);
				nft.image = normalizeLocalUrl(nft.image);
			}
			if (nft.video) {
				nft.video = decodeBase64Uri(nft.video);
				nft.video = normalizeLocalUrl(nft.video);
			}
			
			// Replace ipfs:// with https://ipfs.io/ipfs/ if present
			if (nft.image && nft.image.startsWith('ipfs://')) {
				nft.image = nft.image.replace('ipfs://', 'https://ipfs.io/ipfs/');
			}
			if (nft.video && nft.video.startsWith('ipfs://')) {
				nft.video = nft.video.replace('ipfs://', 'https://ipfs.io/ipfs/');
			}
		});

		// Process Rarity calculations before rendering
		const processedNfts = calculateRarity(rawNfts);

		// Initialize the gallery manager
		new MvxPinterestGallery(container, processedNfts, config);
	});
});

/**
 * Shuffle Helper
 */
function shuffleArray(array) {
	const arr = [...array];
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

/**
 * Rarity Calculation Engine
 * Computes frequency percentage for each trait value and ranks NFTs.
 */
function calculateRarity(nfts) {
	if (!nfts || nfts.length === 0) return [];

	const totalNfts = nfts.length;
	const traitCounts = {};

	// 1. First pass: Count occurrences of all traits
	nfts.forEach(nft => {
		const attributes = nft.attributes || [];
		
		// Group attributes by type to avoid duplicate traits on single NFT
		const seenTraitsThisNft = new Set();

		attributes.forEach(attr => {
			const traitType = attr.trait_type || attr.key || '';
			const value = attr.value || '';
			
			if (!traitType || !value) return;

			const key = `${traitType}::${value}`;

			if (!traitCounts[traitType]) {
				traitCounts[traitType] = {};
			}

			if (!seenTraitsThisNft.has(key)) {
				traitCounts[traitType][value] = (traitCounts[traitType][value] || 0) + 1;
				seenTraitsThisNft.add(key);
			}
		});
	});

	// 2. Second pass: Calculate Rarity Score for each NFT
	// Formula: Rarity Score = Sum ( 1 / (Trait Value Frequency / Total NFTs) )
	nfts.forEach(nft => {
		const attributes = nft.attributes || [];
		let rarityScore = 0;

		attributes.forEach(attr => {
			const traitType = attr.trait_type || attr.key || '';
			const value = attr.value || '';
			
			if (traitType && value && traitCounts[traitType] && traitCounts[traitType][value]) {
				const freq = traitCounts[traitType][value];
				const traitPercentage = freq / totalNfts;
				
				// Add inverse of percentage frequency to the rarity score
				rarityScore += (1 / traitPercentage);
				
				// Inject calculated percentage frequency into the trait object for UI display
				attr.frequency = (traitPercentage * 100).toFixed(2);
				attr.count = freq;
			}
		});

		nft.rarityScore = rarityScore;
	});

	// 3. Sort NFTs by rarity score descending and assign rarity rank
	const sortedByRarity = [...nfts].sort((a, b) => b.rarityScore - a.rarityScore);
	sortedByRarity.forEach((nft, index) => {
		nft.rarityRank = index + 1; // Rank #1 is rarest
	});

	return nfts;
}

/**
 * Gallery controller class
 */
class MvxPinterestGallery {
	constructor(container, nfts, config) {
		this.container = container;
		this.nfts = nfts;
		this.filteredNfts = [...nfts];
		this.config = config;

		this.grid = container.querySelector('.mvx-nft-grid');
		this.loader = container.querySelector('.mvx-nft-loader');
		this.filterBar = container.querySelector('.mvx-nft-filter-bar');
		this.modal = container.querySelector('.mvx-nft-modal');
		this.paginationContainer = container.querySelector('.mvx-nft-pagination');

		// State management for filters
		this.searchQuery = '';
		this.sortBy = config.sortBy || 'newest'; // default sorting from configuration
		this.selectedTraits = {}; // e.g. { "Background": "Blue", "Eyes": "Laser" }

		// Pagination state
		this.rows = config.rows || 'all';
		this.currentPage = 0;
		this.pageSize = isNaN(parseInt(this.rows)) ? this.nfts.length : (parseInt(this.config.columns) * parseInt(this.rows));

		this.init();
	}

	init() {
		// Move modal to body to center it in viewport and bypass parent transforms
		if (this.modal) {
			document.body.appendChild(this.modal);
		}

		// Hide Loader
		if (this.loader) this.loader.style.display = 'none';

		// Generate filtering widgets
		if (this.config.showFilters || this.config.showSearch) {
			this.renderFilterBar();
		}

		// Hook up filter toggle button
		const toggleBtn = this.container.querySelector('.mvx-btn-toggle-filters');
		if (toggleBtn && this.filterBar) {
			this.filterBar.style.display = 'none'; // hidden by default
			toggleBtn.addEventListener('click', () => {
				const isVisible = this.filterBar.style.display !== 'none';
				if (isVisible) {
					this.filterBar.style.display = 'none';
					toggleBtn.classList.remove('active');
				} else {
					this.filterBar.style.display = 'block';
					toggleBtn.classList.add('active');
				}
			});
		}

		// Hook up pagination events
		if (this.paginationContainer) {
			const prevBtn = this.paginationContainer.querySelector('.mvx-btn-prev');
			const nextBtn = this.paginationContainer.querySelector('.mvx-btn-next');
			if (prevBtn) {
				prevBtn.addEventListener('click', () => {
					if (this.currentPage > 0) {
						this.currentPage--;
						this.renderGrid();
						this.container.scrollIntoView({ behavior: 'smooth' });
					}
				});
			}
			if (nextBtn) {
				nextBtn.addEventListener('click', () => {
					const totalPages = Math.ceil(this.filteredNfts.length / this.pageSize);
					if (this.currentPage < totalPages - 1) {
						this.currentPage++;
						this.renderGrid();
						this.container.scrollIntoView({ behavior: 'smooth' });
					}
				});
			}
		}

		// Initial display of the grid with default filter/sorting applied
		this.applyFiltersAndSort();

		// Set up global layout resize listener for Pinterest Masonry calculations
		window.addEventListener('resize', () => this.resizeAllGridItems());

		// Hook up modal close handlers
		const closeBtn = this.modal.querySelector('.mvx-nft-modal-close');
		const overlay = this.modal.querySelector('.mvx-nft-modal-overlay');
		if (closeBtn) closeBtn.addEventListener('click', () => this.closeModal());
		if (overlay) overlay.addEventListener('click', () => this.closeModal());
		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') this.closeModal();
		});
	}

	/**
	 * Build Filter panel and search inputs
	 */
	renderFilterBar() {
		if (!this.filterBar) return;

		let html = '';

		// Search Input Row
		html += `<div class="mvx-nft-filter-row-top">`;
		if (this.config.showSearch) {
			html += `
				<div class="mvx-search-input-wrapper">
					<input type="text" class="mvx-search-field" placeholder="Search by name or token ID..." />
				</div>
			`;
		}

		// Sorting Select
		html += `
			<div class="mvx-sort-wrapper">
				<select class="mvx-sort-select">
					<option value="newest" ${this.sortBy === 'newest' ? 'selected' : ''}>Newest Minted (Nonce Desc)</option>
					<option value="oldest" ${this.sortBy === 'oldest' ? 'selected' : ''}>Oldest Minted (Nonce Asc)</option>
					<option value="rarity-rare" ${this.sortBy === 'rarity-rare' ? 'selected' : ''}>Rarest First</option>
					<option value="rarity-common" ${this.sortBy === 'rarity-common' ? 'selected' : ''}>Common First</option>
					<option value="alpha-asc" ${this.sortBy === 'alpha-asc' ? 'selected' : ''}>Name: A - Z</option>
					<option value="alpha-desc" ${this.sortBy === 'alpha-desc' ? 'selected' : ''}>Name: Z - A</option>
					<option value="random" ${this.sortBy === 'random' ? 'selected' : ''}>Random</option>
				</select>
			</div>
		`;
		html += `</div>`; // End Top Row

		// Dynamic Trait Dropdowns Row
		if (this.config.showFilters) {
			// Extract all traits
			const traitMap = {};
			this.nfts.forEach(nft => {
				(nft.attributes || []).forEach(attr => {
					const type = attr.trait_type || attr.key || '';
					const val = attr.value || '';
					if (type && val) {
						if (!traitMap[type]) {
							traitMap[type] = new Set();
						}
						traitMap[type].add(val);
					}
				});
			});

			const traitTypes = Object.keys(traitMap).sort();

			if (traitTypes.length > 0) {
				html += `<div class="mvx-nft-filter-row-bottom">`;
				
				traitTypes.forEach(traitType => {
					const values = Array.from(traitMap[traitType]).sort();
					html += `
						<div class="mvx-filter-group">
							<div class="mvx-filter-group-label">${traitType}</div>
							<select class="mvx-filter-select" data-trait="${traitType}">
								<option value="">All</option>
								${values.map(val => `<option value="${val}">${val}</option>`).join('')}
							</select>
						</div>
					`;
				});

				html += `<button class="mvx-filter-clear">Reset Filters</button>`;
				html += `</div>`; // End Bottom Row
			}
		}

		this.filterBar.innerHTML = html;

		// Attach event listeners
		const searchField = this.filterBar.querySelector('.mvx-search-field');
		if (searchField) {
			searchField.addEventListener('input', (e) => {
				this.searchQuery = e.target.value.toLowerCase().trim();
				this.applyFiltersAndSort();
			});
		}

		const sortSelect = this.filterBar.querySelector('.mvx-sort-select');
		if (sortSelect) {
			sortSelect.addEventListener('change', (e) => {
				this.sortBy = e.target.value;
				this.applyFiltersAndSort();
			});
		}

		const filterSelects = this.filterBar.querySelectorAll('.mvx-filter-select');
		filterSelects.forEach(select => {
			select.addEventListener('change', (e) => {
				const traitType = e.target.getAttribute('data-trait');
				const value = e.target.value;
				if (value === '') {
					delete this.selectedTraits[traitType];
				} else {
					this.selectedTraits[traitType] = value;
				}
				this.applyFiltersAndSort();
			});
		});

		const clearBtn = this.filterBar.querySelector('.mvx-filter-clear');
		if (clearBtn) {
			clearBtn.addEventListener('click', () => {
				this.selectedTraits = {};
				this.searchQuery = '';
				if (searchField) searchField.value = '';
				filterSelects.forEach(select => select.value = '');
				this.applyFiltersAndSort();
			});
		}
	}

	/**
	 * Main filter and sorting logic
	 */
	applyFiltersAndSort() {
		// 1. Apply Filtering
		this.filteredNfts = this.nfts.filter(nft => {
			// Search Query Filter
			if (this.searchQuery) {
				const nameMatch = nft.name && nft.name.toLowerCase().includes(this.searchQuery);
				const idMatch = nft.identifier && nft.identifier.toLowerCase().includes(this.searchQuery);
				const nonceMatch = nft.nonce && String(nft.nonce).includes(this.searchQuery);
				
				if (!nameMatch && !idMatch && !nonceMatch) {
					return false;
				}
			}

			// Trait Selection Filter
			for (const traitType in this.selectedTraits) {
				const selectedVal = this.selectedTraits[traitType];
				const nftHasTrait = (nft.attributes || []).some(attr => {
					const type = attr.trait_type || attr.key || '';
					return type === traitType && attr.value === selectedVal;
				});

				if (!nftHasTrait) {
					return false;
				}
			}

			return true;
		});

		// 2. Apply Sorting
		switch (this.sortBy) {
			case 'oldest':
				this.filteredNfts.sort((a, b) => a.nonce - b.nonce);
				break;
			case 'rarity-rare':
				this.filteredNfts.sort((a, b) => a.rarityRank - b.rarityRank);
				break;
			case 'rarity-common':
				this.filteredNfts.sort((a, b) => b.rarityRank - a.rarityRank);
				break;
			case 'alpha-asc':
				this.filteredNfts.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
				break;
			case 'alpha-desc':
				this.filteredNfts.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
				break;
			case 'random':
				this.filteredNfts = shuffleArray(this.filteredNfts);
				break;
			case 'newest':
			default:
				this.filteredNfts.sort((a, b) => b.nonce - a.nonce);
				break;
		}

		// 3. Reset pagination page on filter change
		this.currentPage = 0;

		// 4. Render grid with filtered and sorted items
		this.renderGrid();
	}

	/**
	 * Build Grid layout dynamically
	 */
	renderGrid() {
		if (!this.grid) return;

		if (this.filteredNfts.length === 0) {
			this.grid.innerHTML = `
				<div class="mvx-no-results" style="grid-column: 1 / -1;">
					<p>No NFTs match your criteria.</p>
				</div>
			`;
			if (this.paginationContainer) this.paginationContainer.style.display = 'none';
			return;
		}

		// Calculate total pages
		const totalPages = Math.ceil(this.filteredNfts.length / this.pageSize);

		// Render pagination controls
		if (this.paginationContainer) {
			if (totalPages <= 1 || isNaN(parseInt(this.rows))) {
				this.paginationContainer.style.display = 'none';
			} else {
				this.paginationContainer.style.display = 'flex';
				const prevBtn = this.paginationContainer.querySelector('.mvx-btn-prev');
				const nextBtn = this.paginationContainer.querySelector('.mvx-btn-next');
				const info = this.paginationContainer.querySelector('.mvx-pagination-info');

				if (info) info.textContent = `Page ${this.currentPage + 1} of ${totalPages}`;
				if (prevBtn) prevBtn.disabled = (this.currentPage === 0);
				if (nextBtn) nextBtn.disabled = (this.currentPage >= totalPages - 1);
			}
		}

		// Slice filtered NFTs for pagination
		const start = this.currentPage * this.pageSize;
		const end = start + this.pageSize;
		const pageNfts = this.filteredNfts.slice(start, end);

		// Map to card nodes
		const cardsHtml = pageNfts.map(nft => {
			const isVideoNft = !!nft.video;
			const hasValidImage = nft.image && nft.image !== nft.video && !nft.image.match(/\.(mp4|webm|ogg|mov)$/i);
			return `
				<div class="mvx-nft-card" data-identifier="${nft.identifier}">
					<div class="mvx-nft-card-content">
						<div class="mvx-nft-img-wrapper" style="position:relative; overflow:hidden;">
							<!-- Display Lazy loaded images/placeholders with fallback -->
							${isVideoNft ? `
								${hasValidImage ? `
									<img data-src="${nft.image}" data-fallback="${nft.imageFallback || ''}" class="mvx-nft-img mvx-nft-thumb" alt="${nft.name}" />
									<video data-src="${nft.video}" class="mvx-nft-hover-video" loop muted playsinline style="display:none; width:100%; height:100%; position:absolute; top:0; left:0; object-fit:cover; z-index:2; border-radius:var(--mvx-card-radius);"></video>
								` : `
									<video data-src="${nft.video}" class="mvx-nft-img mvx-nft-hover-video" loop muted playsinline style="display:block; width:100%; height:auto; object-fit:cover; z-index:2; border-radius:var(--mvx-card-radius);"></video>
								`}
								<div class="mvx-play-badge">
									<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
										<path d="M8 5v14l11-7z"/>
									</svg>
								</div>
							` : `
								<img data-src="${nft.image}" data-fallback="${nft.imageFallback || ''}" class="mvx-nft-img" alt="${nft.name}" />
							`}
						</div>
						<div class="mvx-nft-card-overlay">
							<h3 class="mvx-nft-title">${nft.name}</h3>
							<div class="mvx-nft-card-footer">
								<span class="mvx-nft-nonce">#${nft.nonce}</span>
								<span class="mvx-nft-rarity-badge">Rank #${nft.rarityRank}</span>
							</div>
						</div>
					</div>
				</div>
			`;
		}).join('');

		this.grid.innerHTML = cardsHtml;

		// Hook up Card click events & Hover events
		const cards = this.grid.querySelectorAll('.mvx-nft-card');
		cards.forEach(card => {
			card.addEventListener('click', () => {
				const id = card.getAttribute('data-identifier');
				const nft = this.nfts.find(item => item.identifier === id);
				if (nft) this.openModal(nft);
			});

			// Setup Hover video play/pause dynamically
			card.addEventListener('mouseenter', () => {
				const video = card.querySelector('.mvx-nft-hover-video');
				const thumb = card.querySelector('.mvx-nft-thumb');
				const playBadge = card.querySelector('.mvx-play-badge');
				
				if (video) {
					// Hide thumb & playBadge, play video
					if (thumb) {
						thumb.style.opacity = '0';
						video.style.display = 'block';
					}
					if (playBadge) playBadge.style.opacity = '0';

					const src = video.getAttribute('data-src') || video.src;
					if (src && !video.src) {
						video.src = src;
						video.load();
					}
					video.play().catch(e => console.warn("Video hover play interrupted:", e));
				}
			});

			card.addEventListener('mousemove', (e) => {
				const rect = card.getBoundingClientRect();
				const x = e.clientX - rect.left;
				const y = e.clientY - rect.top;
				const centerX = rect.width / 2;
				const centerY = rect.height / 2;
				const rotateX = ((y - centerY) / centerY) * -12; // 12 deg max
				const rotateY = ((x - centerX) / centerX) * 12;
				
				card.style.transition = 'none';
				card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02) translateY(-8px)`;
				card.style.zIndex = '10'; // Bring to front
			});

			card.addEventListener('mouseleave', () => {
				// Reset 3D rotation
				card.style.transition = '';
				card.style.transform = '';
				card.style.zIndex = '';

				const video = card.querySelector('.mvx-nft-hover-video');
				const thumb = card.querySelector('.mvx-nft-thumb');
				const playBadge = card.querySelector('.mvx-play-badge');
				
				if (video) {
					// Pause video, show thumb & playBadge
					video.pause();
					if (thumb) {
						video.style.display = 'none';
						thumb.style.opacity = '1';
					}
					if (playBadge) playBadge.style.opacity = '1';
				}
			});
		});

		// Trigger lazy loading
		this.lazyLoadImages();

		// Perform masonry grid heights adjustments
		this.resizeAllGridItems();
	}

	/**
	 * Intersection observer lazy loader
	 */
	lazyLoadImages() {
		const imgs = this.grid.querySelectorAll('.mvx-nft-img');
		
		const observer = new IntersectionObserver((entries, self) => {
			entries.forEach(entry => {
				if (entry.isIntersecting) {
					const img = entry.target;
					
					if (img.tagName.toLowerCase() !== 'img' && img.tagName.toLowerCase() !== 'video') {
						// For div placeholders
						img.classList.add('loaded');
						this.resizeGridItem(img.closest('.mvx-nft-card'));
					} else {
						const src = img.getAttribute('data-src');
						if (src) {
							if (img.tagName.toLowerCase() === 'video') {
								const handleVideoLoad = () => {
									img.classList.add('loaded');
									this.resizeGridItem(img.closest('.mvx-nft-card'));
								};
								
								const handleVideoError = () => {
									const fallbackImg = document.createElement('img');
									fallbackImg.className = img.className;
									fallbackImg.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100%" height="100%" fill="%23222"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23666" font-size="12">No Image</text></svg>';
									fallbackImg.classList.add('loaded');
									img.parentNode.replaceChild(fallbackImg, img);
									this.resizeGridItem(fallbackImg.closest('.mvx-nft-card'));
								};

								img.addEventListener('loadeddata', handleVideoLoad);
								img.addEventListener('error', handleVideoError);
								
								img.src = src;
								img.load();
							} else {
								const handleLoad = () => {
									img.classList.add('loaded');
									this.resizeGridItem(img.closest('.mvx-nft-card'));
								};
								
								const showFallback = () => {
									img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100%" height="100%" fill="%23222"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23666" font-size="12">No Image</text></svg>';
									img.classList.add('loaded');
									this.resizeGridItem(img.closest('.mvx-nft-card'));
								};

								const handleError = () => {
									// If image fails to load, check if we have a fallback image URL (e.g. raw IPFS link)
									const fallbackUrl = img.getAttribute('data-fallback');
									if (fallbackUrl && img.src !== fallbackUrl) {
										img.src = fallbackUrl;
										// Remove attribute to avoid loop if fallback also fails
										img.removeAttribute('data-fallback');
									} else {
										// If image fails to load, check if the source is actually a video (e.g. extensionless IPFS links)
										if (img.tagName.toLowerCase() === 'img' && src) {
											// Normalize URL first to prevent CORS blocks on HEAD checks
											const currentHost = window.location.hostname.replace('www.', '');
											let testSrc = src;
											try {
												const parsed = new URL(src);
												const parsedHost = parsed.hostname.replace('www.', '');
												if (parsedHost === currentHost) {
													testSrc = window.location.origin + parsed.pathname + parsed.search + parsed.hash;
												}
											} catch (e) {}

											fetch(testSrc, { method: 'HEAD' })
												.then(response => {
													const contentType = response.headers.get('content-type') || '';
													if (contentType.startsWith('video/')) {
														// It's a video! Replace <img> with <video>
														const videoEl = document.createElement('video');
														videoEl.className = 'mvx-nft-img mvx-nft-hover-video';
														videoEl.loop = true;
														videoEl.muted = true;
														videoEl.playsInline = true;
														videoEl.style.display = 'block';
														videoEl.style.width = '100%';
														videoEl.style.height = 'auto';
														videoEl.style.objectFit = 'cover';
														videoEl.style.zIndex = '2';
														videoEl.style.borderRadius = 'var(--mvx-card-radius)';
														videoEl.setAttribute('data-src', src);
														videoEl.src = src;
														img.parentNode.replaceChild(videoEl, img);
														
														// Initialize video load
														videoEl.classList.add('loaded');
														this.resizeGridItem(videoEl.closest('.mvx-nft-card'));
														videoEl.load();
													} else {
														showFallback();
													}
												})
												.catch(() => {
													showFallback();
												});
										} else {
											showFallback();
										}
									}
								};

								// Attach listeners before setting src to catch synchronous loads
								img.addEventListener('load', handleLoad);
								img.addEventListener('error', handleError);
								
								img.src = src;

								// If already cached and loaded synchronously
								if (img.complete && img.naturalWidth) {
									handleLoad();
								}
							}
						}
					}
					self.unobserve(img);
				}
			});
		}, { rootMargin: '0px 0px 200px 0px' });

		imgs.forEach(img => observer.observe(img));
	}

	/**
	 * Pinterest Masonry Calculation
	 */
	resizeGridItem(item) {
		if (!item) return;
		const rowHeight = 10; // matches grid-auto-rows: 10px;
		const rowGap = 20;    // matches grid-gap: 20px;
		
		// Find inner content box height
		const content = item.querySelector('.mvx-nft-card-content');
		if (!content) return;

		// Reset span to get accurate height
		item.style.gridRowEnd = 'auto';
		
		const contentHeight = content.getBoundingClientRect().height;
		
		// Calculate row span size
		const rowSpan = Math.ceil((contentHeight + rowGap) / (rowHeight + rowGap));
		item.style.gridRowEnd = 'span ' + rowSpan;
	}

	/**
	 * Recalculate heights for all items
	 */
	resizeAllGridItems() {
		const items = this.grid.querySelectorAll('.mvx-nft-card');
		items.forEach(item => {
			// Trigger calculation (often fails if images are loading, which is why image load event also triggers it)
			this.resizeGridItem(item);
		});
	}

	/**
	 * Open Lightbox Modal displaying details, traits and rarity percentages
	 */
	openModal(nft) {
		if (!this.modal) return;

		const modalBody = this.modal.querySelector('.mvx-nft-modal-body');
		if (!modalBody) return;

		// Generate marketplace links
		const identifier = nft.identifier;
		
		// OOX directs to collection URL instead of individual NFT
		const parts = identifier.split('-');
		parts.pop(); // remove nonce
		const collectionId = parts.join('-');
		const ooxUrl = `https://www.oox.art/marketplace/collections/${collectionId}`;
		
		const xoxnoUrl = `https://xoxno.com/nft/${identifier}`;

		// Generate traits HTML
		let traitsHtml = '';
		if (nft.attributes && nft.attributes.length > 0) {
			traitsHtml += `<h4 class="mvx-modal-traits-title">Attributes & Rarity</h4>`;
			traitsHtml += `<div class="mvx-modal-traits">`;

			nft.attributes.forEach(attr => {
				const type = attr.trait_type || attr.key || '';
				const val = attr.value || '';
				const freq = attr.frequency || '0.00';

				// Determine bar color based on rarity
				let barColor = 'var(--mvx-accent-color)';
				const numFreq = parseFloat(freq);
				if (numFreq <= 2.0) {
					barColor = '#EF4444'; // Ultra rare red
				} else if (numFreq <= 5.0) {
					barColor = '#F59E0B'; // Rare amber
				}

				traitsHtml += `
					<div class="mvx-trait-card">
						<div class="mvx-trait-type">${type}</div>
						<div class="mvx-trait-value">${val}</div>
						<div class="mvx-trait-percentage-bar-wrapper">
							<div class="mvx-trait-percentage-bar" style="width: ${freq}%; background-color: ${barColor};"></div>
						</div>
						<div class="mvx-trait-freq">${freq}% have this</div>
					</div>
				`;
			});

			traitsHtml += `</div>`;
		} else {
			traitsHtml = `<p class="mvx-text-secondary" style="font-size:14px; font-style:italic;">No custom traits specified for this NFT.</p>`;
		}

		modalBody.innerHTML = `
			<div class="mvx-modal-grid">
				<div class="mvx-modal-media">
					${nft.video ? `<video src="${nft.video}" controls autoplay loop style="width:100%; border-radius:var(--mvx-card-radius); border:1px solid var(--mvx-border-color); display:block;"></video>` : `<img src="${nft.image}" alt="${nft.name}" />`}
				</div>
				<div class="mvx-modal-details">
					<div class="mvx-modal-header">
						<h2 class="mvx-modal-title">${nft.name}</h2>
						<div class="mvx-modal-meta">
							<span class="mvx-nft-nonce" style="font-size:16px;">#${nft.nonce}</span>
							<span class="mvx-nft-rarity-badge" style="font-size:11px; padding: 4px 10px;">Rarity Rank #${nft.rarityRank} / ${this.nfts.length}</span>
						</div>
					</div>
					
					<p class="mvx-modal-desc">${nft.description || 'No description available.'}</p>
					
					${traitsHtml}
					
					<div class="mvx-modal-actions">
						<a href="${nft.explorerUrl}" target="_blank" rel="noopener noreferrer" class="mvx-btn mvx-btn-primary">View on Explorer</a>
						<a href="${ooxUrl}" target="_blank" rel="noopener noreferrer" class="mvx-btn mvx-btn-secondary">OOX</a>
						<a href="${xoxnoUrl}" target="_blank" rel="noopener noreferrer" class="mvx-btn mvx-btn-secondary">XOXNO</a>
					</div>
				</div>
			</div>
		`;

		this.modal.style.display = 'flex';
		document.body.style.overflow = 'hidden'; // Stop background scrolling
	}

	closeModal() {
		if (!this.modal) return;
		this.modal.style.display = 'none';
		document.body.style.overflow = ''; // Resume background scrolling
	}
}
