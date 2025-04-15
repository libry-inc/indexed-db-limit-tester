document.addEventListener('DOMContentLoaded', () => {
	// --- 定数定義 ---
	const DB_NAME = 'IndexedDBLimitTesterDB';
	const DB_VERSION = 1;
	const CAPACITY_STORE = 'capacityStore';
	const SIZE_STORE = 'sizeStore';
	const COUNT_STORE = 'countStore';

	const CAPACITY_CHUNK_MB = 10; // 1回に追加するデータ量 (MiB)
	const CAPACITY_TARGET_MB = 3 * 1024; // 目標総容量 3 GiB (MiB)
	const SINGLE_ITEM_TARGET_MB = 300; // 目標単一データサイズ (MiB)
	const ITEM_COUNT_TARGET = 10000; // 目標データ件数

	// 確認ダイアログ表示頻度
	const CAPACITY_TEST_TRIAL_FREQUENCY = 100; // 容量テストの確認頻度
	const OTHER_TEST_TRIAL_FREQUENCY = 10;    // 他のテストの確認頻度 (現在サイズテストのみ対象)

	// --- グローバル変数 ---
	let db = null;
	let isTestRunning = false; // テスト実行中フラグ
	let testAborted = false;   // テスト中断フラグ

	// --- DOM Elements ---
	const checkStorageBtn = document.getElementById('checkStorageBtn');
	const storageResult = document.getElementById('storageResult');
	const persistBtn = document.getElementById('persistBtn');
	const persistResult = document.getElementById('persistResult');
	const testCapacityBtn = document.getElementById('testCapacityBtn');
	const capacityResult = document.getElementById('capacityResult');
	const capacityProgress = document.getElementById('capacityProgress');
	const testSingleSizeBtn = document.getElementById('testSingleSizeBtn');
	const singleSizeResult = document.getElementById('singleSizeResult');
	const singleSizeProgress = document.getElementById('singleSizeProgress');
	const testCountBtn = document.getElementById('testCountBtn');
	const countResult = document.getElementById('countResult');
	const countProgress = document.getElementById('countProgress');
	const clearDbBtn = document.getElementById('clearDbBtn');
	const clearDbResult = document.getElementById('clearDbResult');
	const allButtons = document.querySelectorAll('button');

	// --- Helper Functions ---

	/**
	 * Log message to console and designated result area, with scroll control and limit.
	 * @param {HTMLElement} resultElm - The HTML element to display the log.
	 * @param {string} message - The message to log.
	 * @param {'info' | 'success' | 'error' | 'progress' | 'warning'} type - Log type.
	 * @param {boolean} clear - Clear previous content before logging.
	 */
	 function log(resultElm, message, type = 'info', clear = false) {
	    // Log to console regardless of UI state
	    console[type === 'error' ? 'error' : 'log'](`[${type.toUpperCase()}] ${message}`);

	    // Ensure resultElm is valid before proceeding
	    if (!resultElm) {
		console.warn("Log target element is invalid.");
		return;
	    }

	    if (clear) {
		resultElm.innerHTML = '';
	    }

	    // Check if the user is scrolled near the bottom before adding the new log
	    const scrollTolerance = 10; // Pixels of tolerance
	    const isScrolledNearBottom = resultElm.scrollHeight - resultElm.clientHeight <= resultElm.scrollTop + scrollTolerance;

	    // Limit the number of log entries to prevent performance issues
	    const MAX_LOG_ENTRIES = 200; // Keep the last 200 entries
	    while (resultElm.childElementCount >= MAX_LOG_ENTRIES) {
		if (resultElm.firstChild) {
		     resultElm.removeChild(resultElm.firstChild); // Remove the oldest entry
		} else {
		    break; // Should not happen, but safety break
		}
	    }

	    // Add the new log entry
	    const logEntry = document.createElement('div');
	    logEntry.textContent = message; // Use textContent for security unless HTML is intended
	    logEntry.className = `log-${type}`; // Use className for broader compatibility
	    resultElm.appendChild(logEntry);

	    // Scroll to bottom only if the user was already near the bottom
	    if (isScrolledNearBottom) {
		resultElm.scrollTop = resultElm.scrollHeight;
	    }
	}


	/** Disable all buttons */
	function disableAllButtons() {
	    allButtons.forEach(btn => btn.disabled = true);
	}

	/** Enable all buttons */
	function enableAllButtons() {
	    allButtons.forEach(btn => btn.disabled = false);
	}

	/**
	 * Format bytes to human-readable string (KiB, MiB, GiB)
	 * @param {number} bytes - Number of bytes.
	 * @returns {string} Formatted string.
	 */
	function formatBytes(bytes) {
	    if (bytes === 0) return '0 Bytes';
	    const k = 1024;
	    const sizes = ['Bytes', 'KiB', 'MiB', 'GiB', 'TiB'];
	    if (isNaN(bytes) || bytes < 0) return 'Invalid size';
	    // Handle Infinity case
	    if (!isFinite(bytes)) return 'Infinity';
	    try {
		const i = Math.max(0, Math.floor(Math.log(bytes) / Math.log(k)));
		 const index = Math.min(i, sizes.length - 1);
		 // Ensure result is not NaN if bytes is extremely small but positive
		 const value = parseFloat((bytes / Math.pow(k, index)).toFixed(2));
		return (isNaN(value) ? 0 : value) + ' ' + sizes[index];
	    } catch (e) {
		 // Math.log(0) or other math errors
		 console.error("Error formatting bytes:", bytes, e);
		 return "Error";
	    }
	}

	 /**
	 * Create a string of 'a' characters of specified size in MiB.
	 * @param {number} sizeInMB - Size in MiB.
	 * @returns {string} Generated string.
	 */
	 function createData(sizeInMB) {
	    const sizeInBytes = sizeInMB * 1024 * 1024;
	    if (sizeInBytes <= 0) return '';
	    try {
		 if (sizeInBytes < 10) return JSON.stringify({padding: 'a'.repeat(Math.max(0, Math.floor(sizeInBytes)))});
		 const byteCount = Math.floor(sizeInBytes);
		 if (byteCount <= 0) return '';
		 // Using Array(n+1).join('a') might be slightly more performant in some engines
		 // for very large strings compared to 'a'.repeat(n)
		 if (typeof Array.prototype.join === 'function') {
		    return new Array(byteCount + 1).join('a');
		 } else {
		     // Fallback just in case .join is somehow unavailable (highly unlikely)
		     return 'a'.repeat(byteCount);
		 }
	    } catch (e) {
		console.error(`Error creating data string of ${formatBytes(sizeInBytes)}:`, e);
		// Add more context to the error message thrown
		throw new Error(`Failed to create data string of size ${formatBytes(sizeInBytes)} (likely JS limits). ${e.message}`);
	    }
	}


	/**
	 * Open IndexedDB database.
	 * @returns {Promise<IDBDatabase>} Promise resolving with the database instance.
	 */
	function openDB() {
	    return new Promise((resolve, reject) => {
		// Check if a valid connection already exists
		if (db && db.objectStoreNames.length > 0 && db.version === DB_VERSION) {
		    resolve(db);
		    return;
		}
		 // If db exists but is closed or wrong version, ensure it's nullified before reopening
		 if (db) {
		    console.log("Closing existing potentially invalid DB connection before reopening.");
		     closeDB(); // Request close, but proceed to open
		 }

		console.log(`Opening database: ${DB_NAME} version: ${DB_VERSION}`);
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = (event) => {
		    const tempDb = event.target.result;
		    console.log(`Database upgrade needed from version ${event.oldVersion} to ${event.newVersion}`);
		    log(capacityResult, "データベーススキーマを更新中...", 'info'); // Use a relevant log area
		    if (!tempDb.objectStoreNames.contains(CAPACITY_STORE)) {
			console.log(`Creating object store: ${CAPACITY_STORE}`);
			tempDb.createObjectStore(CAPACITY_STORE);
		    }
		    if (!tempDb.objectStoreNames.contains(SIZE_STORE)) {
			console.log(`Creating object store: ${SIZE_STORE}`);
			tempDb.createObjectStore(SIZE_STORE);
		    }
		     if (!tempDb.objectStoreNames.contains(COUNT_STORE)) {
			console.log(`Creating object store: ${COUNT_STORE}`);
			 tempDb.createObjectStore(COUNT_STORE, { autoIncrement: true });
		     }
		     log(capacityResult, "データベーススキーマ更新完了。", 'info');
		};

		request.onsuccess = (event) => {
		    db = event.target.result;
		    console.log("Database opened successfully.");

		    db.onversionchange = () => {
			 log(storageResult, "データベースのバージョンが外部で変更されました。接続を閉じます。ページのリロードが必要かもしれません。", "warning", true); // Use storageResult as a general area
			 closeDB();
			 // alert("データベースのバージョンが変更されたため、ページをリロードする必要があります。");
			 // window.location.reload();
		    };

		     db.onclose = () => {
			 console.log("Database connection closed event received.");
			 db = null; // Ensure db is nullified when closed
		     };

		     db.onerror = (event) => {
			 // Handle errors that bubble up to the database connection
			 console.error("Database connection error:", event.target.error);
			 log(storageResult, `データベース接続エラー: ${event.target.error}`, 'error');
		     }

		    resolve(db);
		};

		request.onerror = (event) => {
		    console.error("Database open error:", event.target.error);
		    log(storageResult, `データベースオープンエラー: ${event.target.error}`, 'error', true);
		    reject(event.target.error);
		};

		 request.onblocked = (event) => {
		     console.warn("Database open blocked. Close other connections/tabs.", event);
		     log(storageResult, "データベースのオープン/アップグレードがブロックされました。このサイトを開いている他のタブを全て閉じてから再試行してください。", "error", true);
		     reject(new Error("Database open blocked"));
		 };
	    });
	}

	 /**
	 * Close the database connection.
	 */
	function closeDB() {
	    if (db) {
		try {
		     db.close();
		     console.log("Database connection close requested.");
		     // The actual closing and setting db=null is handled by the onclose event handler
		} catch (e) {
		    console.error("Error attempting to close DB:", e);
		     db = null; // Force nullify if close throws error
		}
	    }
	}

	 /**
	 * Add or update data in a specific object store.
	 * @param {string} storeName - Name of the object store.
	 * @param {any} key - The key for the data.
	 * @param {any} value - The data to store.
	 * @returns {Promise<void>} Promise resolving on success.
	 */
	function putData(storeName, key, value) {
	    return new Promise(async (resolve, reject) => {
		let transaction;
		try {
		    const currentDb = await openDB();
		    // Check if store exists before starting transaction
		     if (!currentDb.objectStoreNames.contains(storeName)) {
			 return reject(new Error(`Object store "${storeName}" not found.`));
		     }
		    transaction = currentDb.transaction([storeName], 'readwrite');
		    const store = transaction.objectStore(storeName);
		    const request = store.put(value, key);

		    request.onerror = (event) => {
			console.error(`Put error (key: ${key}) in store ${storeName}:`, event.target.error);
			// Prevent default error handling? No, let transaction handle it.
		    };

		    transaction.oncomplete = () => resolve();
		    transaction.onerror = (event) => {
			console.error(`Transaction error during put in ${storeName}:`, event.target.error);
			reject(event.target.error);
		    };
		     transaction.onabort = (event) => {
			 console.warn(`Transaction aborted during put in ${storeName}:`, event.target.error);
			 reject(event.target.error || new Error("Transaction aborted"));
		     };

		} catch (error) {
		     console.error(`Error initiating put transaction for ${storeName}:`, error);
		     if (transaction && transaction.abort && !transaction.error) { // Avoid aborting if already errored
			 try { transaction.abort(); } catch(e){}
		     }
		    reject(error);
		}
	    });
	}

	 /**
	 * Add data (expects unique key or auto-increment).
	 * @param {string} storeName - Name of the object store.
	 * @param {any} value - The data to store.
	 * @param {any} [key] - Optional key (if store not auto-incrementing).
	 * @returns {Promise<IDBValidKey>} Promise resolving with the key on success.
	 */
	function addData(storeName, value, key) {
	    return new Promise(async (resolve, reject) => {
		let transaction;
		 try {
		    const currentDb = await openDB();
		     if (!currentDb.objectStoreNames.contains(storeName)) {
			 return reject(new Error(`Object store "${storeName}" not found.`));
		     }
		    transaction = currentDb.transaction([storeName], 'readwrite');
		    const store = transaction.objectStore(storeName);
		    const request = key !== undefined ? store.add(value, key) : store.add(value);

		    let resultKey = null;

		    request.onsuccess = (event) => {
			resultKey = event.target.result;
		    };
		    request.onerror = (event) => {
			console.error(`Add error in store ${storeName}:`, event.target.error);
			// Don't reject here yet
		    };

		    transaction.oncomplete = () => resolve(resultKey);
		    transaction.onerror = (event) => {
			console.error(`Transaction error during add in ${storeName}:`, event.target.error);
			reject(event.target.error);
		    };
		     transaction.onabort = (event) => {
			 console.warn(`Transaction aborted during add in ${storeName}:`, event.target.error);
			 reject(event.target.error || new Error("Transaction aborted"));
		     };
		} catch (error) {
		    console.error(`Error initiating add transaction for ${storeName}:`, error);
		     if (transaction && transaction.abort && !transaction.error) {
			 try { transaction.abort(); } catch(e){}
		     }
		    reject(error);
		}
	    });
	}

	/**
	 * Add multiple data items in a single transaction.
	 * @param {string} storeName - The object store name.
	 * @param {number} count - Number of items to add.
	 * @param {any} dataItem - The data to add for each item.
	 * @returns {Promise<void>} Promise resolving on success.
	 */
	function addBatchData(storeName, count, dataItem) {
	    return new Promise(async (resolve, reject) => {
		let transaction;
		try {
		    const currentDb = await openDB();
		     if (!currentDb.objectStoreNames.contains(storeName)) {
			 return reject(new Error(`Object store "${storeName}" not found.`));
		     }
		    transaction = currentDb.transaction([storeName], 'readwrite');
		    const store = transaction.objectStore(storeName);
		    let addedCount = 0;
		    let errorsEncountered = 0; // Count errors within the batch

		     transaction.oncomplete = () => {
			 if (errorsEncountered === 0) {
			    resolve();
			 } else {
			     // Transaction completed, but some individual adds might have failed
			     console.warn(`Batch add transaction completed for ${storeName}, but ${errorsEncountered} individual add errors occurred.`);
			     reject(new Error(`Batch add completed with ${errorsEncountered} errors.`));
			 }
		     };
		     transaction.onerror = (event) => {
			// This catches errors that abort the *entire* transaction
			console.error(`Transaction error during batch add in ${storeName} after approx ${addedCount} adds:`, event.target.error);
			reject(event.target.error);
		    };
		     transaction.onabort = (event) => {
			 console.warn(`Transaction aborted during batch add in ${storeName}:`, event.target.error);
			 reject(event.target.error || new Error("Transaction aborted"));
		     };

		    for (let i = 0; i < count; i++) {
			 try {
			    const request = store.add(dataItem);
			    request.onsuccess = () => { addedCount++; };
			    request.onerror = (event) => {
				errorsEncountered++;
				console.warn(`Error adding item ${i + 1} of ${count} in batch to ${storeName}:`, event.target.error);
				// Prevent the error from bubbling up and potentially aborting the transaction immediately
				// Allowing the transaction to proceed might add subsequent items successfully.
				 event.preventDefault(); // Important to prevent transaction abort on single item error
			    };
			 } catch (addError) {
			     // Catch synchronous errors from store.add if any occur (unlikely)
			     errorsEncountered++;
			     console.error(`Synchronous error on store.add in batch for ${storeName}:`, addError);
			 }
		    }

		} catch (error) {
		     console.error(`Error initiating batch add transaction for ${storeName}:`, error);
		     if (transaction && transaction.abort && !transaction.error) {
			 try { transaction.abort(); } catch(e){}
		     }
		    reject(error);
		}
	    });
	}


	/**
	 * Clear all data from specified object stores.
	 * @param {string[]} storeNames - Array of store names to clear.
	 * @returns {Promise<void>} Promise resolving on success.
	 */
	function clearStores(storeNames) {
	    return new Promise(async (resolve, reject) => {
		 let transaction;
		 try {
		    const currentDb = await openDB();
		    // Filter out store names that don't actually exist
		     const existingStoreNames = storeNames.filter(name => currentDb.objectStoreNames.contains(name));
		     if (existingStoreNames.length === 0) {
			 console.log("No existing stores found to clear from the provided list:", storeNames);
			 return resolve(); // Nothing to clear
		     }

		    transaction = currentDb.transaction(existingStoreNames, 'readwrite');
		    let storesCleared = 0;

		    transaction.oncomplete = () => {
			console.log(`Stores cleared successfully: ${existingStoreNames.join(', ')}`);
			resolve();
		    };
		    transaction.onerror = (event) => {
			 console.error(`Transaction error during clearStores for ${existingStoreNames.join(', ')}:`, event.target.error);
			reject(event.target.error);
		    };
		    transaction.onabort = (event) => {
			 console.warn(`Transaction aborted during clearStores for ${existingStoreNames.join(', ')}:`, event.target.error);
			 reject(event.target.error || new Error("Transaction aborted"));
		     };

		    existingStoreNames.forEach(storeName => {
			try {
			    const store = transaction.objectStore(storeName);
			    const request = store.clear();
			    request.onsuccess = () => { storesCleared++; };
			    request.onerror = (event) => {
				 console.error(`Error clearing store ${storeName}:`, event.target.error);
				 // Don't reject here, let transaction error handle it
				 // event.preventDefault(); // Maybe prevent default to allow transaction to continue? Test this.
			    }
			} catch (storeError) {
			    console.error(`Error accessing store ${storeName} during clear:`, storeError);
			}
		    });
		} catch (error) {
		     console.error(`Error initiating clearStores transaction for ${storeNames.join(', ')}:`, error);
		     if (transaction && transaction.abort && !transaction.error) {
			 try { transaction.abort(); } catch(e){}
		     }
		    reject(error);
		}
	    });
	}

	/**
	 * Delete the entire IndexedDB database.
	 * @returns {Promise<void>} Promise resolving on success.
	 */
	function deleteDB() {
	    return new Promise((resolve, reject) => {
		console.log(`Requesting closure of DB connection before deletion attempt...`);
		closeDB(); // Request close

		// Give the browser a moment to process the close request before deleting
		setTimeout(() => {
		     console.log(`Attempting to delete database: ${DB_NAME}`);
		     try {
			const deleteRequest = indexedDB.deleteDatabase(DB_NAME);

			deleteRequest.onsuccess = (event) => {
			    console.log(`Database ${DB_NAME} delete request successful.`);
			    db = null; // Ensure db var is nullified
			    resolve();
			};

			deleteRequest.onerror = (event) => {
			    console.error(`Error deleting database ${DB_NAME}:`, event.target.error);
			    reject(event.target.error);
			};

			deleteRequest.onblocked = (event) => {
			    console.warn(`Database ${DB_NAME} deletion blocked. Old version: ${event.oldVersion}, New version: ${event.newVersion}`);
			    log(clearDbResult, "データベースの削除がブロックされました。このサイトを開いている他のタブを全て閉じてから、再度削除ボタンを押してください。", "error");
			    reject(new Error('Database deletion blocked. Close other connections.'));
			};
		     } catch (deleteError) {
			 console.error(`Synchronous error trying to delete database ${DB_NAME}:`, deleteError);
			 reject(deleteError);
		     }
		 }, 200); // Increased delay slightly
	    });
	}


	/**
	 * Check trial count against a specified frequency and ask user to continue.
	 * @param {number} currentTrial - The current trial number (1-based).
	 * @param {string} testName - The name of the test for the dialog message.
	 * @param {number} frequency - Show confirm dialog every 'frequency' trials.
	 * @returns {Promise<boolean>} Promise resolving with true to continue, false to stop.
	 */
	function checkTrialLimit(currentTrial, testName, frequency) {
	    // Only check if frequency is positive and trial count matches frequency
	    if (frequency > 0 && currentTrial > 0 && currentTrial % frequency === 0) {
		// Pause the test slightly before showing confirm to allow UI updates
		log(capacityResult, `--- ${currentTrial}回の試行完了、確認中 ---`, 'info'); // Log before dialog
		return new Promise(resolve => setTimeout(() => {
		     let continueTest = false;
		     try {
			 // Wrap confirm in try-catch in case it fails in edge cases
			 continueTest = confirm(`${testName}: ${currentTrial}回の試行が完了しました。テストを続行しますか？ (ブラウザが重くなる可能性があります)`);
		     } catch (e) {
			 console.error("Error showing confirmation dialog:", e);
			 continueTest = false; // Assume stop if dialog fails
		     }
		     resolve(continueTest);
		}, 100)); // Increased delay slightly
	    }
	    // Continue if frequency not met or frequency <= 0
	    return Promise.resolve(true);
	}

	// --- Test Functions ---

	/** Test 1: Capacity Limit Test */
	async function runCapacityTest() {
	    log(capacityResult, '容量上限テストを開始します...', 'info', true);
	    capacityProgress.value = 0;
	    capacityProgress.max = CAPACITY_TARGET_MB;
	    disableAllButtons();
	    isTestRunning = true;
	    testAborted = false;

	    let totalAddedMB = 0;
	    let trial = 0;
	    let success = true;
	    let finalMessage = '';

	    try {
		await openDB();

		while (totalAddedMB < CAPACITY_TARGET_MB) {
		     if (testAborted) {
			finalMessage = 'テストがユーザーによって中断されました。';
			log(capacityResult, finalMessage, 'warning');
			success = false;
			break;
		    }

		    trial++;
		     const continueTesting = await checkTrialLimit(trial, '容量上限テスト', CAPACITY_TEST_TRIAL_FREQUENCY);
		     if (!continueTesting) {
			  finalMessage = `ユーザーが${trial}回試行後にテストを中止しました。`;
			  log(capacityResult, finalMessage, 'warning');
			  testAborted = true;
			  success = false;
			  break;
		      }

		    const dataKey = `capacity_data_${Date.now()}_${trial}`;
		    let dataToAdd = '';
		    log(capacityResult, `試行 ${trial}: ${CAPACITY_CHUNK_MB} MiB データ生成中...`, 'progress');
		    try {
			 dataToAdd = createData(CAPACITY_CHUNK_MB);
		     } catch (creationError) {
			 log(capacityResult, `データ生成エラー (${formatBytes(CAPACITY_CHUNK_MB * 1024 * 1024)}): ${creationError.message}`, 'error');
			 finalMessage = `テスト失敗: ${CAPACITY_CHUNK_MB}MiB データ生成エラー。`;
			 success = false;
			 break;
		     }

		    log(capacityResult, `試行 ${trial}: ${CAPACITY_CHUNK_MB} MiB 追加中... (合計: ${formatBytes(totalAddedMB * 1024 * 1024)})`, 'progress');
		    try {
			await addData(CAPACITY_STORE, dataToAdd, dataKey);
			totalAddedMB += CAPACITY_CHUNK_MB;
			capacityProgress.value = totalAddedMB;
			log(capacityResult, `試行 ${trial}: ${CAPACITY_CHUNK_MB} MiB 追加成功。合計 ${formatBytes(totalAddedMB * 1024 * 1024)}。`, 'info');

		    } catch (error) {
			console.error(`Capacity test error during add (Trial ${trial}):`, error);
			if (error.name === 'QuotaExceededError') {
			    finalMessage = `容量上限エラー (${error.name})。推定上限: 約 ${formatBytes(totalAddedMB * 1024 * 1024)} (今回の ${CAPACITY_CHUNK_MB} MiB 追加中に発生)`;
			} else {
			    finalMessage = `試行 ${trial} でエラー (${error.name}): ${error.message}. 推定上限: 約 ${formatBytes(totalAddedMB * 1024 * 1024)}`;
			}
			success = false;
			log(capacityResult, finalMessage, 'error');
			break;
		    }
		} // end while loop

		if (success && totalAddedMB >= CAPACITY_TARGET_MB) {
		    finalMessage = `テスト成功: ${formatBytes(CAPACITY_TARGET_MB * 1024 * 1024)} 以上の容量を確認！ (合計: ${formatBytes(totalAddedMB * 1024 * 1024)})`;
		    log(capacityResult, finalMessage, 'success');
		} else if (success && !testAborted) { // Reached end without hitting target and not aborted
		     finalMessage = `テスト完了。目標容量には達しませんでした (確認容量: ${formatBytes(totalAddedMB * 1024 * 1024)})。`;
		     log(capacityResult, finalMessage, 'warning');
		} // Aborted message already logged in loop

	    } catch (error) {
		console.error("Capacity test general error:", error);
		log(capacityResult, `テスト中に予期せぬエラーが発生しました: ${error}`, 'error');
		success = false; // Mark as not successful on general error
	    } finally {
		isTestRunning = false;
		enableAllButtons();
		 // Log final status if it wasn't explicitly set before exiting due to error
		 if (!finalMessage && !success) {
		     log(capacityResult, "テストはエラーにより終了しました。", "error");
		 }
	    }
	}


	/** Test 2: Single Item Size Limit Test (Exponential + Binary Search - Corrected) */
	async function runSingleItemSizeTest() {
	    log(singleSizeResult, '単一データサイズ上限テストを開始します (指数増加 + 二分探索)...', 'info', true);
	    singleSizeProgress.value = 0;
	    singleSizeProgress.max = SINGLE_ITEM_TARGET_MB;
	    disableAllButtons();
	    isTestRunning = true;
	    testAborted = false;

	    let lowerBoundMB = 0;
	    let upperBoundMB = Infinity;
	    let currentSizeMB = 1; // Start exponential phase at 1 MiB
	    let phase = 'exponential';
	    let trial = 0;
	    let success = true; // Tracks if the overall goal (finding limit or hitting target) was met
	    let finalMessage = '';
	    const dataKey = 'single_item_test_key';
	    const PRECISION_MB = 1;

	    try {
		await openDB();
		 try {
		     await putData(SIZE_STORE, dataKey, ''); // Clear previous test data
		     log(singleSizeResult, '既存のテストキーデータをクリアしました。', 'info');
		 } catch (clearError) {
		     log(singleSizeResult, `テストキーのクリア中にエラー: ${clearError}`, 'warning');
		 }

		while (true) { // Loop managed by break conditions
		    if (testAborted) {
			finalMessage = 'テストがユーザーによって中断されました。';
			 log(singleSizeResult, finalMessage, 'warning');
			success = false; // Aborted, so didn't necessarily succeed in finding limit
			break;
		    }

		    trial++;
		     const continueTesting = await checkTrialLimit(trial, '単一データサイズ上限テスト', OTHER_TEST_TRIAL_FREQUENCY);
		     if (!continueTesting) {
			 finalMessage = `ユーザーが${trial}回試行後にテストを中止しました。`;
			 log(singleSizeResult, finalMessage, 'warning');
			  testAborted = true;
			 success = false; // Aborted
			 break;
		     }

		    let testSizeMB = 0;
		    if (phase === 'exponential') {
			testSizeMB = currentSizeMB;
			 // Prevent testing excessively large sizes in exponential phase if upper bound known
			 if (upperBoundMB !== Infinity && testSizeMB >= upperBoundMB) {
			     log(singleSizeResult, `指数ステップ (${formatBytes(testSizeMB*1024*1024)}) が既知の上限 (${formatBytes(upperBoundMB*1024*1024)}) を超えるため二分探索へ移行。`, 'info');
			     phase = 'binary';
			     continue; // Re-evaluate size in binary phase
			 }
			 log(singleSizeResult, `試行 ${trial} (指数): ${formatBytes(testSizeMB * 1024 * 1024)} 格納試行...`, 'progress');
		    } else { // Binary phase
			 // Check termination condition for binary search
			 if (upperBoundMB - lowerBoundMB <= PRECISION_MB) {
			     finalMessage = `二分探索完了。推定上限: 約 ${formatBytes(lowerBoundMB * 1024 * 1024)}。`;
			     log(singleSizeResult, finalMessage, 'success'); // Finding the bound is success
			     break;
			 }
			 // Calculate midpoint, ensure it makes progress
			 testSizeMB = lowerBoundMB + Math.max(1, Math.floor((upperBoundMB - lowerBoundMB) / 2)); // Ensure at least 1 MiB step
			 // Safety check: Ensure testSizeMB is less than upperBoundMB
			 if (testSizeMB >= upperBoundMB) {
			     testSizeMB = Math.max(lowerBoundMB + 1, upperBoundMB - 1); // Try just below upper bound
			     if (testSizeMB <= lowerBoundMB) { // Bounds are too close, likely found limit
				  finalMessage = `二分探索完了 (境界接近)。推定上限: 約 ${formatBytes(lowerBoundMB * 1024 * 1024)}。`;
				  log(singleSizeResult, finalMessage, 'success');
				  break;
			     }
			 }

			 log(singleSizeResult, `試行 ${trial} (二分): 範囲 [${formatBytes(lowerBoundMB*1024*1024)}, ${formatBytes(upperBoundMB*1024*1024)}) で ${formatBytes(testSizeMB * 1024 * 1024)} 試行...`, 'progress');
		    }
		     singleSizeProgress.value = testSizeMB; // Show attempted size

		     let dataToAdd = '';
		     log(singleSizeResult, `... ${formatBytes(testSizeMB * 1024 * 1024)} データ生成中 ...`, 'progress');
		     try {
			 dataToAdd = createData(testSizeMB);
		     } catch (creationError) {
			 log(singleSizeResult, `データ生成エラー (${formatBytes(testSizeMB * 1024 * 1024)}): ${creationError.message}`, 'error');
			 upperBoundMB = testSizeMB; // Assume this size is impossible
			 if (phase === 'exponential') {
			     log(singleSizeResult, `指数フェーズでデータ生成失敗。二分探索へ移行: [${formatBytes(lowerBoundMB*1024*1024)}, ${formatBytes(upperBoundMB*1024*1024)})`, 'warning');
			     phase = 'binary';
			     if (lowerBoundMB >= upperBoundMB) { // Error on first try
				finalMessage = `初回 (${formatBytes(testSizeMB*1024*1024)}) でデータ生成エラー。テスト中止。`;
				log(singleSizeResult, finalMessage, 'error'); success = false; break;
			     }
			 } else { // Binary phase
			     log(singleSizeResult, `二分探索フェーズでデータ生成失敗。上限を ${formatBytes(upperBoundMB * 1024 * 1024)} に設定。`, 'warning');
			 }
			 continue; // Skip storage attempt
		     }

		     try {
			await putData(SIZE_STORE, dataKey, dataToAdd);
			// --- Success ---
			lowerBoundMB = testSizeMB;
			singleSizeProgress.value = lowerBoundMB; // Show successful size
			log(singleSizeResult, `サイズ ${formatBytes(lowerBoundMB * 1024 * 1024)} 格納成功。`, 'info');

			if (lowerBoundMB >= SINGLE_ITEM_TARGET_MB) {
			     finalMessage = `テスト成功: 目標 ${formatBytes(SINGLE_ITEM_TARGET_MB * 1024 * 1024)} 以上のデータ格納確認 (確認サイズ: ${formatBytes(lowerBoundMB * 1024 * 1024)})`;
			     log(singleSizeResult, finalMessage, 'success');
			     break; // Target reached
			 }

			 if (phase === 'exponential') {
			     let nextSize = currentSizeMB * 2;
			     // Optional: Add limit to exponential growth? e.g., max 1 GiB jump?
			     // if (nextSize - currentSizeMB > 1024) nextSize = currentSizeMB + 1024;
			     currentSizeMB = nextSize;
			     // Check if next jump would exceed known upper bound
			      if (upperBoundMB !== Infinity && currentSizeMB >= upperBoundMB) {
				  log(singleSizeResult, "次の指数ステップが既知上限を超えるため二分探索へ移行。", "info");
				  phase = 'binary';
			      }
			 } // In binary phase, loop continues with updated lowerBound

		     } catch (error) {
			 // --- Failure ---
			 console.error(`Single size test error (Size ${testSizeMB} MiB):`, error);
			 upperBoundMB = testSizeMB; // Current attempt failed, so it's the new upper bound
			 singleSizeProgress.value = lowerBoundMB; // Show last successful size
			 log(singleSizeResult, `サイズ ${formatBytes(testSizeMB * 1024 * 1024)} 格納エラー (${error.name})。上限を ${formatBytes(upperBoundMB*1024*1024)} 未満に設定。`, 'warning');

			 if (phase === 'exponential') {
			     phase = 'binary';
			     log(singleSizeResult, `指数フェーズでエラー。二分探索へ移行: [${formatBytes(lowerBoundMB*1024*1024)}, ${formatBytes(upperBoundMB*1024*1024)})`, 'info');
			      if (lowerBoundMB >= upperBoundMB) { // Error on first try
				  finalMessage = `初回 (${formatBytes(testSizeMB*1024*1024)}) で格納エラー。上限は非常に小さいかゼロです。`;
				  log(singleSizeResult, finalMessage, 'error'); success = false; break;
			      }
			 } // In binary phase, loop continues with updated upperBound

			 // Check termination condition again after error, in case bounds are now close
			 if (upperBoundMB - lowerBoundMB <= PRECISION_MB) {
			     finalMessage = `二分探索完了 (エラー後)。推定上限: 約 ${formatBytes(lowerBoundMB * 1024 * 1024)}。`;
			      log(singleSizeResult, finalMessage, 'success'); // Finding bound is success
			     break;
			 }
		     }
		} // end while loop

		// Final log if loop exited without specific message (e.g., aborted early)
		if (!finalMessage) {
		    if (success && phase === 'binary') { // Ended during binary search without hitting target or precision
			log(singleSizeResult, `テスト完了。確認できた最大サイズ: ${formatBytes(lowerBoundMB * 1024 * 1024)}。上限は ${formatBytes(upperBoundMB * 1024 * 1024)} 未満。`, 'warning');
		    } else if (!success) { // General failure or abort
			log(singleSizeResult, `テストが完了または中断しました。最後に成功したサイズ: ${formatBytes(lowerBoundMB * 1024 * 1024)}`, 'warning');
		    }
		}

	    } catch (error) {
		console.error("Single item size test general error:", error);
		log(singleSizeResult, `テスト中に予期せぬエラーが発生しました: ${error}`, 'error');
		success = false; // Mark as not successful on general error
	    } finally {
		isTestRunning = false;
		enableAllButtons();
		 // Log final status if it wasn't explicitly set before exiting due to error
		 if (!finalMessage && !success) {
		     log(singleSizeResult, "テストはエラーにより終了しました。", "error");
		 }
	    }
	}


	/** Test 3: Item Count Limit Test (Batch Add + Single Add Fallback, No Trial Limit) */
	async function runItemCountTest() {
	    log(countResult, 'データ件数上限テストを開始します (バッチ追加 + 1件追加)...', 'info', true);
	    countProgress.value = 0;
	    countProgress.max = ITEM_COUNT_TARGET * 1.2; // Allow progress beyond target
	    disableAllButtons();
	    isTestRunning = true;
	    testAborted = false;

	    let itemCount = 0;
	    let batchSize = 100;
	    let success = true; // Tracks if target met or limit found without unexpected errors
	    let finalMessage = '';
	    let phase = 'batch';
	    const itemData = { d: "item_padding_data_for_count_test" }; // Slightly more realistic data?
	    let lastLoggedCount = -1; // Prevent excessive logging in single mode

	    try {
		await openDB();
		log(countResult, '既存の件数テストデータをクリア中...', 'info');
		try {
		     await clearStores([COUNT_STORE]);
		     log(countResult, 'クリア完了。テスト開始。', 'info');
		} catch(e){
		     log(countResult, `ストアのクリア中にエラー: ${e}`, 'warning');
		}


		while (true) { // Loop managed by break conditions
		     if (testAborted) {
			finalMessage = 'テストがユーザーによって中断されました。';
			 log(countResult, finalMessage, 'warning');
			success = false; // Aborted, didn't finish goal
			break;
		    }

		    if (phase === 'batch') {
			// Safety: Prevent excessively large batch sizes if something goes wrong
			if (batchSize > 500000) { // Limit batch size increase
			    log(countResult, `バッチサイズ (${batchSize.toLocaleString()}) が大きすぎるため、1件追加モードに移行します。`, 'warning');
			    phase = 'single';
			    continue;
			}
			log(countResult, `フェーズ 'batch': ${batchSize.toLocaleString()} 件追加試行 (現在 ${itemCount.toLocaleString()} 件)...`, 'progress');
			try {
			    await addBatchData(COUNT_STORE, batchSize, itemData);
			    itemCount += batchSize;
			    countProgress.value = itemCount;
			    log(countResult, `${batchSize.toLocaleString()} 件追加成功。合計 ${itemCount.toLocaleString()} 件。`, 'info');

			    // Increase batch size (e.g., x10, consider less aggressive?)
			    batchSize = Math.min(batchSize * 10, 500000); // Increase but cap

			     if (itemCount >= ITEM_COUNT_TARGET) {
				finalMessage = `テスト成功 (バッチ): 目標 ${ITEM_COUNT_TARGET.toLocaleString()} 件以上 (${itemCount.toLocaleString()} 件) 格納確認！`;
				log(countResult, finalMessage, 'success');
				 // Optional: Switch to single mode to find exact limit?
				 // phase = 'single'; log(countResult, "目標達成後、正確な上限特定のため1件追加モードに移行...", "info"); continue;
				 break; // Stop as target reached
			     }

			} catch (error) {
			    console.error(`Batch add error (${batchSize} items, current total ${itemCount}):`, error);
			    log(countResult, `${batchSize.toLocaleString()} 件バッチ追加エラー (${error.name})。1件追加モードへ移行。`, 'warning');
			    phase = 'single'; // Switch to single item addition
			    countProgress.value = itemCount; // Show count before failed batch
			}
		    } else { // phase === 'single'
			 // Log single add attempt less frequently
			 if (itemCount % 500 === 0 && itemCount !== lastLoggedCount) {
			     log(countResult, `フェーズ 'single': ${itemCount + 1} 件目追加試行...`, 'progress');
			     lastLoggedCount = itemCount; // Update last logged count
			 }

			try {
			     await addData(COUNT_STORE, itemData);
			     itemCount++;
			     countProgress.value = itemCount;

			    // Check if target met during single add phase
			    if (itemCount === ITEM_COUNT_TARGET) {
				  log(countResult, `目標 ${ITEM_COUNT_TARGET.toLocaleString()} 件達成 (1件追加中)。上限探索のため続行します。`, 'info');
			     }
			     // Add a safety break much higher than target
			     if (itemCount > ITEM_COUNT_TARGET * 10) { // More generous safety break
				 finalMessage = `件数が目標 (${ITEM_COUNT_TARGET.toLocaleString()}) を大幅超過 (${itemCount.toLocaleString()}) したためテスト終了。上限は非常に高い可能性があります。`;
				 log(countResult, finalMessage, 'warning');
				 break;
			     }

			} catch (error) {
			     console.error(`Single add error (Item ${itemCount + 1}):`, error);
			      if (error.name === 'QuotaExceededError') {
				  finalMessage = `件数上限エラー (${error.name})。推定上限: ${itemCount.toLocaleString()} 件。`;
			     } else {
				 finalMessage = `${itemCount + 1} 件目追加で予期せぬエラー (${error.name}): ${error.message}. 推定上限: ${itemCount.toLocaleString()} 件。`;
			     }
			     success = false; // Limit found via error
			     log(countResult, finalMessage, 'error');
			     countProgress.value = itemCount; // Show last successful count
			     break; // Stop test on single item failure
			}
		    } // end phase check

		} // end while loop

		// Final log messages if loop broken by conditions other than direct error reporting
		 if (!finalMessage) {
		     if (success) { // Ended, likely via target reached break or safety break
			 log(countResult, `テスト完了。最終件数: ${itemCount.toLocaleString()}`, 'info');
		     } else { // Aborted
			 log(countResult, `テストが中断されました。最終確認件数: ${itemCount.toLocaleString()}`, 'warning');
		     }
		 }

	    } catch (error) {
		console.error("Item count test general error:", error);
		log(countResult, `テスト中に予期せぬエラーが発生しました: ${error}`, 'error');
		 success = false; // Mark as not successful on general error
	    } finally {
		isTestRunning = false;
		enableAllButtons();
		 // Log final status if it wasn't explicitly set before exiting due to error
		 if (!finalMessage && !success) {
		     log(countResult, `テストはエラーにより終了しました。最終確認件数: ${itemCount.toLocaleString()}`, "error");
		 }
	    }
	}

	// --- Storage API Functions ---

	/** Check current storage usage and quota */
	async function checkStorageEstimate(clear = true) {
	    if (navigator.storage && navigator.storage.estimate) {
		// Use a temporary div for logging if clearing, to avoid flicker/scroll issues
		const targetLogElement = clear ? document.createElement('div') : storageResult;
		if(clear) storageResult.innerHTML = ''; // Clear immediately

		log(targetLogElement, "現在の使用量/割り当て量を確認中...", 'info', false); // Log to temp or final element
		disableAllButtons();
		try {
		    const estimate = await navigator.storage.estimate();
		    const usage = formatBytes(estimate.usage || 0); // Default to 0 if undefined
		    const quota = formatBytes(estimate.quota || 0);
		    let usageDetailsText = '';
		    if (estimate.usageDetails) {
			 // Ensure properties exist before accessing
			usageDetailsText += ` (内訳: IndexedDB=${formatBytes(estimate.usageDetails.indexedDB || 0)}`;
			usageDetailsText += `, Caches=${formatBytes(estimate.usageDetails.caches || 0)}`;
			 // ServiceWorker usage often negligible, omit for brevity unless needed
			// usageDetailsText += `, ServiceWorker=${formatBytes(estimate.usageDetails.serviceWorkerRegistrations || 0)}`;
			usageDetailsText += ')';
		    }

		     const resultHTML = `現在の使用量: ${usage}${usageDetailsText}\n割り当て量: ${quota}`;
		     log(targetLogElement, resultHTML, 'success', false);

		    // Check persisted state
		    if (navigator.storage.persisted) {
			 const persisted = await navigator.storage.persisted();
			 const persistedText = `永続化状態: ${persisted ? '有効' : '無効'}`;
			 log(targetLogElement, persistedText, persisted ? 'success' : 'info', false);
		    } else {
			 log(targetLogElement, "永続化状態API (persisted) はサポートされていません。", 'warning', false);
		    }

		     // If using a temporary div, now copy its content to the actual result area
		     if (clear) {
			 storageResult.innerHTML = targetLogElement.innerHTML;
			 // Trigger scroll update if needed after content replacement
			 storageResult.scrollTop = storageResult.scrollHeight;
		     }


		} catch (error) {
		    console.error("Storage estimate error:", error);
		    log(storageResult, `容量情報の取得エラー: ${error}`, 'error', clear); // Log error directly to final area
		} finally {
		     enableAllButtons();
		}
	    } else {
		log(storageResult, "Storage API (estimate) はこのブラウザではサポートされていません。", 'warning', clear);
	    }
	}

	/** Request persistent storage */
	async function requestPersistence() {
	    // Check for both persist and persisted for better feature detection
	    if (navigator.storage && navigator.storage.persist && navigator.storage.persisted) {
		log(persistResult, "永続ストレージの状態を確認し、必要ならリクエストします...", 'info', true);
		 disableAllButtons();
		try {
		    let persisted = await navigator.storage.persisted();
		     log(persistResult, `現在の永続化状態: ${persisted ? '有効' : '無効'}`, persisted ? 'success' : 'info');

		     if (persisted) {
			 log(persistResult, "ストレージは既に永続化されています。リクエストは不要です。", 'info');
		     } else {
			 log(persistResult, "永続ストレージをリクエスト中...", 'progress');
			 const granted = await navigator.storage.persist();
			 if (granted) {
			     log(persistResult, "永続ストレージのリクエストが許可されました。", 'success');
			 } else {
			     log(persistResult, "永続ストレージのリクエストが許可されませんでした。", 'warning');
			     log(persistResult, "(理由: ユーザー拒否、エンゲージメント不足、容量不足等)", "info");
			 }
			 // Verify again after request
			 persisted = await navigator.storage.persisted();
			 log(persistResult, `リクエスト後の永続化状態: ${persisted ? '有効' : '無効'}`, persisted ? 'success' : 'info');
		    }

		} catch (error) {
		    console.error("Persistence request error:", error);
		    log(persistResult, `永続化リクエスト/確認エラー: ${error}`, 'error');
		} finally {
		     enableAllButtons();
		}
	    } else {
		log(persistResult, "Storage API (persist/persisted) はこのブラウザではサポートされていません。", 'warning', true);
	    }
	}

	 /** Clear all test data */
	async function clearAllTestData() {
	    if (isTestRunning) {
		 log(clearDbResult, "実行中のテストを中断しようとしています...", "warning", true);
		 testAborted = true;
		 await new Promise(resolve => setTimeout(resolve, 200)); // Wait slightly longer
		 if (isTestRunning) { // Check again if test is still marked as running
		     log(clearDbResult, "テストの中断が完了するのを待っています...", "warning");
		     // Consider adding a timeout or loop to wait for isTestRunning to become false
		     // For simplicity, proceed after the delay for now.
		 }
	    }

	    log(clearDbResult, 'テストデータの削除を開始します...', 'info', true);
	    disableAllButtons();
	    try {
		await deleteDB();
		log(clearDbResult, `データベース '${DB_NAME}' の削除リクエストが完了しました。`, 'success');
		 // Reset UI elements
		 capacityProgress.value = 0;
		 singleSizeProgress.value = 0;
		 countProgress.value = 0;
		 // Clear result areas after successful deletion message
		 setTimeout(() => { // Clear results slightly after success message
		     capacityResult.innerHTML = '';
		     singleSizeResult.innerHTML = '';
		     countResult.innerHTML = '';
		     storageResult.innerHTML = '';
		     persistResult.innerHTML = '';
		     // Re-check storage estimate after deletion
		    checkStorageEstimate(true);
		 }, 50);

	    } catch (error) {
		console.error("Clear data error:", error);
		 log(clearDbResult, `テストデータの削除中にエラーが発生しました: ${error.message}`, 'error');
		 if (!error.message.includes("blocked")) {
		     try {
			 log(clearDbResult, "DB削除失敗のため、ストアクリアを試行...", "warning");
			 await clearStores([CAPACITY_STORE, SIZE_STORE, COUNT_STORE]);
			 log(clearDbResult, "オブジェクトストアのクリアに成功しました。", "success");
		     } catch (clearError) {
			 log(clearDbResult, `ストアクリア試行中にさらにエラー: ${clearError}`, "error");
		     }
		 }
	    } finally {
		enableAllButtons();
		isTestRunning = false; // Ensure flag is false after attempt
	    }
	}


	// --- Event Listeners ---
	if(checkStorageBtn) checkStorageBtn.addEventListener('click', () => checkStorageEstimate(true));
	if(persistBtn) persistBtn.addEventListener('click', requestPersistence);
	if(testCapacityBtn) testCapacityBtn.addEventListener('click', runCapacityTest);
	if(testSingleSizeBtn) testSingleSizeBtn.addEventListener('click', runSingleItemSizeTest);
	if(testCountBtn) testCountBtn.addEventListener('click', runItemCountTest);
	if(clearDbBtn) clearDbBtn.addEventListener('click', clearAllTestData);

	// Initial check on load
	checkStorageEstimate(true);

	 // --- Global Error Handling & Abort Logic ---
	window.addEventListener('unhandledrejection', function(event) {
	  console.error('Unhandled Promise Rejection:', event.reason);
	  // Avoid logging complex objects directly to UI, stringify or extract message
	   const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
	   log(storageResult, `未処理の非同期エラー: ${reason}`, 'error'); // Log to general area
	});

	window.addEventListener('error', function(event) {
	   console.error('Global Error:', event.error || event.message);
	    log(storageResult, `ページエラー: ${event.message}`, 'error');
	});


	 // Handle potential interruptions (e.g., page closing during test)
	 window.addEventListener('beforeunload', (event) => {
	     if (isTestRunning) {
		 const message = 'テストが実行中です。ページを離れると中断されます。本当に離れますか？';
		 event.preventDefault();
		 event.returnValue = message;
		 return message;
	     }
	 });

	 window.addEventListener('unload', () => {
	     if (isTestRunning) {
		 testAborted = true;
		 console.log("Unload event: Signaled test abortion.");
	     }
	     // Close DB connection cleanly on unload/close
	     console.log("Unload event: Closing DB connection.");
	     closeDB();
	 });

	// --- Initialization Complete ---
	console.log("IndexedDB Limit Tester Initialized.");
	log(storageResult,"ツールが初期化されました。テストを開始してください。", "info", true); // Initial ready message

    });
