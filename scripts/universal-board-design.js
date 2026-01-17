import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Cpu, 
  Zap, 
  Trash2, 
  Save, 
  FolderOpen, 
  MousePointer2, 
  Grid3X3, 
  RotateCw, 
  Minus, 
  Plus, 
  Settings,
  Activity,
  Box,
  Type,
  ToggleLeft,
  ToggleRight
} from 'lucide-react';

// --- 初期設定 ---
const PIXELS_PER_MM = 8; // 画面描画のスケール係数（1mm = 8px換算）
const DEFAULT_PITCH = 2.54; // mm
const DEFAULT_GRID_SIZE = DEFAULT_PITCH * PIXELS_PER_MM; // 初期計算: ~20.32px

const DEFAULT_BOARD_WIDTH = 40; // 穴の数（横）
const DEFAULT_BOARD_HEIGHT = 30; // 穴の数（縦）
const HOLE_RADIUS = 2;

// 部品ごとのプレフィックス定義
const COMPONENT_PREFIXES = {
  resistor: 'R',
  capacitor: 'C',
  led: 'D',
  ic_dip: 'U',
  jumper: 'J'
};

// 部品定義
const COMPONENT_DEFINITIONS = {
  RESISTOR: { 
    id: 'resistor', 
    name: '抵抗', 
    defaultWidth: 3, 
    defaultHeight: 1, 
    render: (w, h, gridSize, gridW, gridH) => {
      // 穴（接点）の位置
      const padLeft = gridSize / 2;
      const padRight = w - gridSize / 2;
      
      // 1マス以下（物理的にありえないが）の場合のガード処理
      if (gridW < 2) {
         return (
           <g>
             <circle cx={w/2} cy={h/2} r={gridSize/4} fill="#e5e7eb" stroke="#4b5563" />
             <line x1={w/2} y1={gridSize/4} x2={w/2} y2={h-gridSize/4} stroke="brown" strokeWidth="2" />
           </g>
         );
      }

      // ボディの計算: 接点間距離の60%をボディ幅とする
      const innerDist = padRight - padLeft;
      const bodyWidth = innerDist * 0.6;
      const leadLen = (innerDist - bodyWidth) / 2;

      const bodyStart = padLeft + leadLen;
      const bodyEnd = padRight - leadLen;
      
      return (
        <g>
          {/* 左リード線 */}
          <line x1={padLeft} y1={gridSize/2} x2={bodyStart} y2={gridSize/2} stroke="#ccc" strokeWidth="2" />
          <circle cx={padLeft} cy={gridSize/2} r={2} fill="#9ca3af" />
          
          {/* 右リード線 */}
          <line x1={bodyEnd} y1={gridSize/2} x2={padRight} y2={gridSize/2} stroke="#ccc" strokeWidth="2" />
          <circle cx={padRight} cy={gridSize/2} r={2} fill="#9ca3af" />

          {/* ボディ */}
          <rect x={bodyStart} y={gridSize/4} width={bodyWidth} height={gridSize/2} fill="#e5e7eb" stroke="#4b5563" rx="3" />
          
          {/* カラーコード */}
          <line x1={bodyStart + bodyWidth*0.3} y1={gridSize/4} x2={bodyStart + bodyWidth*0.3} y2={gridSize*0.75} stroke="brown" strokeWidth="2" />
          <line x1={bodyStart + bodyWidth*0.5} y1={gridSize/4} x2={bodyStart + bodyWidth*0.5} y2={gridSize*0.75} stroke="red" strokeWidth="2" />
          <line x1={bodyStart + bodyWidth*0.7} y1={gridSize/4} x2={bodyStart + bodyWidth*0.7} y2={gridSize*0.75} stroke="gold" strokeWidth="2" />
        </g>
      );
    }
  },
  CAPACITOR: { 
    id: 'capacitor', 
    name: 'コンデンサ', 
    defaultWidth: 2, 
    defaultHeight: 1, 
    render: (w, h, gridSize, gridW, gridH) => {
      const padLeft = gridSize / 2;
      const padRight = w - gridSize / 2;
      
      const gap = Math.min(gridSize * 0.4, (padRight - padLeft) * 0.4);
      
      return (
        <g>
          <line x1={padLeft} y1={gridSize/2} x2={w/2 - gap} y2={gridSize/2} stroke="#ccc" strokeWidth="2" />
          <circle cx={padLeft} cy={gridSize/2} r={2} fill="#9ca3af" />

          <line x1={w/2 + gap} y1={gridSize/2} x2={padRight} y2={gridSize/2} stroke="#ccc" strokeWidth="2" />
          <circle cx={padRight} cy={gridSize/2} r={2} fill="#9ca3af" />
          
          <circle cx={w/2} cy={gridSize/2} r={Math.min(gridSize/2.5, (padRight-padLeft)/2)} fill="#3b82f6" stroke="#1d4ed8" />
        </g>
      );
    }
  },
  LED: { 
    id: 'led', 
    name: 'LED', 
    defaultWidth: 1, 
    defaultHeight: 1, 
    render: (w, h, gridSize, gridW, gridH) => {
      const radius = Math.min(w, h) / 2.2;
      const innerRadius = radius * 0.7;
      const cx = w/2;
      const cy = h/2;

      return (
        <g>
          <circle cx={cx} cy={cy} r={radius} fill="rgba(239, 68, 68, 0.2)" stroke="#ef4444" />
          <circle cx={cx} cy={cy} r={innerRadius} fill="#ef4444" />
          <line x1={cx - 2} y1={cy - innerRadius} x2={cx - 2} y2={cy + innerRadius} stroke="white" strokeWidth="1" />
          <line x1={cx + 2} y1={cy} x2={cx + 2} y2={cy + innerRadius} stroke="white" strokeWidth="1" />
          <line x1={cx} y1={cy - innerRadius} x2={cx + innerRadius} y2={cy} stroke="white" strokeWidth="1" />
        </g>
      );
    }
  },
  IC_DIP: { 
    id: 'ic_dip', 
    name: 'IC (DIP)', 
    defaultWidth: 4, 
    // 標準的なDIP IC (300mil) は足の間隔が3マス分。つまり0番目の穴と3番目の穴を使うので、高さとしては4マス分を占有する設定にするのが自然
    defaultHeight: 4, 
    render: (w, h, gridSize, gridW, gridH) => {
      // ボディのサイズ計算
      const padX = Math.min(gridSize / 2, w / 4);
      const padY = Math.min(gridSize / 2, h / 4);

      // ピンの描画位置（高さ方向の中心）
      const topPinCenterY = gridSize / 2;
      const bottomPinCenterY = h - gridSize / 2;
      
      const pinH = gridSize / 2; // ピンの描画上の長さ
      const pinW = 4; // ピンの幅

      // ボディはピンの内側に配置
      const bodyX = padX;
      const bodyY = topPinCenterY + 2; 
      const bodyW = w - padX * 2;
      const bodyH = (bottomPinCenterY - 2) - bodyY;

      const pins = [];
      for (let i = 0; i < gridW; i++) {
        // ピンの描画位置（幅方向の中心）
        const pinCenterX = gridSize * (i + 0.5);
        
        pins.push(
          <React.Fragment key={i}>
            {/* 上のピン */}
            <rect x={pinCenterX - pinW/2} y={topPinCenterY - pinH/2} width={pinW} height={pinH} fill="#9ca3af" />
            <circle cx={pinCenterX} cy={topPinCenterY} r={1.5} fill="#6b7280" /> {/* 穴位置のガイド */}

            {/* 下のピン */}
            <rect x={pinCenterX - pinW/2} y={bottomPinCenterY - pinH/2} width={pinW} height={pinH} fill="#9ca3af" />
            <circle cx={pinCenterX} cy={bottomPinCenterY} r={1.5} fill="#6b7280" />
          </React.Fragment>
        );
      }
      return (
        <g>
          <rect x={bodyX} y={bodyY} width={bodyW} height={bodyH} fill="#1f2937" rx="2" />
          {/* ノッチ */}
          <path d={`M ${bodyX} ${h/2 - 5} Q ${bodyX + 5} ${h/2} ${bodyX} ${h/2 + 5}`} fill="#374151" stroke="none" />
          {bodyW > 20 && bodyH > 10 && (
            <text x={w/2} y={h/2} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="8" style={{ pointerEvents: 'none' }}>IC</text>
          )}
          {pins}
        </g>
      );
    }
  },
  JUMPER: {
    id: 'jumper',
    name: 'ピンヘッダ',
    defaultWidth: 4,
    defaultHeight: 1,
    render: (w, h, gridSize, gridW, gridH) => {
      const pins = [];
      for(let y=0; y<gridH; y++) {
        for(let x=0; x<gridW; x++) {
          pins.push(
            <rect 
              key={`${x}-${y}`}
              // グリッドの中心(gridSize/2)を中心に四角形を描画
              // x = center - size/2
              x={x * gridSize + 2} 
              y={y * gridSize + 2} 
              width={gridSize - 4} 
              height={gridSize - 4} 
              fill="gold" 
              stroke="orange" 
              strokeWidth="1" 
            />
          );
        }
      }
      return <g>{pins}</g>;
    }
  }
};

// 色パレット
const WIRE_COLORS = [
  { name: '赤', value: '#ef4444' },
  { name: '黒', value: '#1f2937' },
  { name: '青', value: '#3b82f6' },
  { name: '黄', value: '#eab308' },
  { name: '緑', value: '#22c55e' },
  { name: '白', value: '#f3f4f6' },
];

export default function UniversalBoardDesigner() {
  // --- State ---
  const [boardConfig, setBoardConfig] = useState({
    width: DEFAULT_BOARD_WIDTH,
    height: DEFAULT_BOARD_HEIGHT,
    pitch: DEFAULT_PITCH,
    gridSize: DEFAULT_GRID_SIZE
  });

  const [components, setComponents] = useState([]);
  const [wires, setWires] = useState([]);
  const [selectedTool, setSelectedTool] = useState('select');
  const [wireColor, setWireColor] = useState(WIRE_COLORS[0].value);
  const [scale, setScale] = useState(1.5);
  const [currentWireStart, setCurrentWireStart] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  
  // ラベル表示フラグ
  const [showLabels, setShowLabels] = useState(true);

  // 各部品ごとの設定サイズを保持するステート
  const [componentSizes, setComponentSizes] = useState(() => {
    return Object.values(COMPONENT_DEFINITIONS).reduce((acc, def) => {
      acc[def.id] = { width: def.defaultWidth, height: def.defaultHeight };
      return acc;
    }, {});
  });

  const [activeSize, setActiveSize] = useState({ width: 0, height: 0 });
  const [draggedComponent, setDraggedComponent] = useState(null);
  const [hoveredGrid, setHoveredGrid] = useState(null);

  const svgRef = useRef(null);
  const containerRef = useRef(null); 

  const getGridCoords = (clientX, clientY) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const x = (clientX - rect.left) / scale;
    const y = (clientY - rect.top) / scale;
    return {
      x: Math.round(x / boardConfig.gridSize),
      y: Math.round(y / boardConfig.gridSize),
    };
  };

  const generateId = () => Math.random().toString(36).substr(2, 9);

  // --- Actions ---

  const selectTool = (toolId) => {
    setSelectedTool(toolId);
    setSelectedItem(null);
    setCurrentWireStart(null);

    if (toolId !== 'select' && toolId !== 'wire') {
      if (componentSizes[toolId]) {
        setActiveSize(componentSizes[toolId]);
      } else {
        const def = Object.values(COMPONENT_DEFINITIONS).find(c => c.id === toolId);
        if (def) {
          setActiveSize({ width: def.defaultWidth, height: def.defaultHeight });
        }
      }
    }
  };

  const handleSizeChange = (key, value) => {
    const newVal = Math.max(1, Number(value));
    const newSize = { ...activeSize, [key]: newVal };
    setActiveSize(newSize);
    if (selectedTool !== 'select' && selectedTool !== 'wire') {
      setComponentSizes(prev => ({
        ...prev,
        [selectedTool]: newSize
      }));
    }
  };

  // 部品の属性（名前・値）変更
  const handleAttributeChange = (key, val) => {
    if (!selectedItem || selectedItem.type !== 'component') return;
    setComponents(prev => prev.map(c => 
      c.id === selectedItem.id ? { ...c, [key]: val } : c
    ));
  };

  const handleMouseDown = (e) => {
    if (draggedComponent) return;
    if (e.button === 2) return;

    const { x, y } = getGridCoords(e.clientX, e.clientY);
    
    if (x < 0 || x > boardConfig.width || y < 0 || y > boardConfig.height) return;

    if (selectedTool === 'wire') {
      setCurrentWireStart({ x, y });
    } else if (selectedTool === 'select') {
      if (e.target.tagName === 'svg' || e.target.id === 'board-bg') {
        setSelectedItem(null);
      }
    } else {
      const compDef = Object.values(COMPONENT_DEFINITIONS).find(c => c.id === selectedTool);
      if (compDef) {
        addComponent({
          id: compDef.id,
          width: activeSize.width,
          height: activeSize.height
        }, x, y);
      }
    }
  };

  const handleMouseMove = (e) => {
    const { x, y } = getGridCoords(e.clientX, e.clientY);

    if (!hoveredGrid || hoveredGrid.x !== x || hoveredGrid.y !== y) {
      setHoveredGrid({ x, y });
    }

    if (draggedComponent) {
      setComponents(prev => prev.map(comp => {
        if (comp.id === draggedComponent.id) {
          const newX = (x - draggedComponent.offsetX) * boardConfig.gridSize;
          const newY = (y - draggedComponent.offsetY) * boardConfig.gridSize;
          return { ...comp, x: newX, y: newY };
        }
        return comp;
      }));
    }
  };

  const handleMouseUp = (e) => {
    if (selectedTool === 'wire' && currentWireStart) {
      const { x, y } = getGridCoords(e.clientX, e.clientY);
      if (x !== currentWireStart.x || y !== currentWireStart.y) {
        addWire(currentWireStart, { x, y });
      }
      setCurrentWireStart(null);
    }
    if (draggedComponent) {
      setDraggedComponent(null);
    }
  };

  const handleMouseLeave = () => {
    setHoveredGrid(null);
  };

  const handleRightClick = (e) => {
    e.preventDefault();
    if (currentWireStart || draggedComponent) {
      setCurrentWireStart(null);
      setDraggedComponent(null);
    } else {
      selectTool('select');
    }
  };

  // ホイールによるズーム制御
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e) => {
      e.preventDefault();
      const delta = -e.deltaY;
      setScale(prevScale => {
        const factor = 1.05;
        const newScale = delta > 0 ? prevScale * factor : prevScale / factor;
        return Math.min(Math.max(0.5, newScale), 5);
      });
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, []);

  const addComponent = (typeDef, gridX, gridY) => {
    const x = gridX * boardConfig.gridSize;
    const y = gridY * boardConfig.gridSize;
    
    // 自動命名: プレフィックス + 連番
    const prefix = COMPONENT_PREFIXES[typeDef.id] || 'P';
    // 既存の同タイプ部品数 + 1 を番号とする（簡易実装）
    const count = components.filter(c => c.type === typeDef.id).length + 1;
    const name = `${prefix}${count}`;

    const newComp = {
      id: generateId(),
      type: typeDef.id,
      x,
      y,
      width: typeDef.width,
      height: typeDef.height,
      rotation: 0,
      name: name,
      value: '', // 説明の初期値
    };
    setComponents([...components, newComp]);
    setSelectedItem({ type: 'component', id: newComp.id });
  };

  const addWire = (start, end) => {
    const newWire = {
      id: generateId(),
      startX: start.x,
      startY: start.y,
      endX: end.x,
      endY: end.y,
      color: wireColor
    };
    setWires([...wires, newWire]);
  };

  const deleteSelected = useCallback(() => {
    if (!selectedItem) return;
    if (selectedItem.type === 'component') {
      setComponents(components.filter(c => c.id !== selectedItem.id));
    } else if (selectedItem.type === 'wire') {
      setWires(wires.filter(w => w.id !== selectedItem.id));
    }
    setSelectedItem(null);
  }, [selectedItem, components, wires]);

  const rotateSelected = useCallback(() => {
    if (selectedItem?.type !== 'component') return;
    setComponents(components.map(c => {
      if (c.id === selectedItem.id) {
        return { ...c, rotation: (c.rotation + 90) % 360 };
      }
      return c;
    }));
  }, [selectedItem, components]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      // 入力フォームでのDeleteキー誤爆防止
      if (e.target.tagName === 'INPUT') return;

      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
      if (e.key === 'r' || e.key === 'R') rotateSelected();
      if (e.key === 'Escape') {
        selectTool('select');
        setDraggedComponent(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelected, rotateSelected]);

  // --- Rendering ---
  
  const renderGridHoles = () => {
    const holes = [];
    for (let y = 0; y <= boardConfig.height; y++) {
      for (let x = 0; x <= boardConfig.width; x++) {
        holes.push(
          <circle
            key={`${x}-${y}`}
            cx={x * boardConfig.gridSize}
            cy={y * boardConfig.gridSize}
            r={HOLE_RADIUS}
            fill="#1f2937"
            opacity={0.3}
            style={{ pointerEvents: 'none' }}
          />
        );
      }
    }
    return holes;
  };

  const handleComponentDragStart = (e, id) => {
    e.stopPropagation();
    if (e.button === 2) return;

    if (selectedTool === 'select') {
      const { x, y } = getGridCoords(e.clientX, e.clientY);
      const comp = components.find(c => c.id === id);
      setSelectedItem({ type: 'component', id });
      if (comp) {
        setDraggedComponent({
          id,
          offsetX: x - (comp.x / boardConfig.gridSize),
          offsetY: y - (comp.y / boardConfig.gridSize)
        });
      }
    }
  };

  const saveDesign = () => {
    const data = JSON.stringify({ components, wires, boardConfig, componentSizes, showLabels });
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'board-design.json';
    a.click();
  };

  const loadDesign = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.boardConfig) {
          const loadedConfig = { ...data.boardConfig };
          if (!loadedConfig.pitch && loadedConfig.gridSize) {
            loadedConfig.pitch = Math.round((loadedConfig.gridSize / PIXELS_PER_MM) * 100) / 100;
          }
          if (loadedConfig.pitch && !loadedConfig.gridSize) {
            loadedConfig.gridSize = loadedConfig.pitch * PIXELS_PER_MM;
          }
          setBoardConfig(loadedConfig);
        }
        setComponents(data.components || []);
        setWires(data.wires || []);
        
        if (data.componentSizes) {
          setComponentSizes(data.componentSizes);
          if (selectedTool !== 'select' && selectedTool !== 'wire' && data.componentSizes[selectedTool]) {
            setActiveSize(data.componentSizes[selectedTool]);
          }
        }
        if (data.showLabels !== undefined) setShowLabels(data.showLabels);

      } catch (err) {
        alert('ファイルの読み込みに失敗しました');
      }
    };
    reader.readAsText(file);
  };

  // 選択中の部品を取得
  const currentSelectedComponent = selectedItem?.type === 'component' 
    ? components.find(c => c.id === selectedItem.id) 
    : null;

  return (
    <div className="flex h-screen bg-gray-100 font-sans text-gray-800 overflow-hidden">
      
      {/* 左サイドバー */}
      <div className="w-72 bg-white border-r border-gray-200 flex flex-col shadow-sm z-10">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-bold flex items-center gap-2 text-indigo-600">
            <Grid3X3 size={20} />
            UniBoard Designer
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          
          {/* 基板設定 */}
          <div className="bg-gray-50 p-3 rounded border border-gray-200">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Settings size={12} /> 基板設定
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="flex flex-col">
                <span className="mb-1 text-gray-600">横穴数</span>
                <input 
                  type="number" 
                  value={boardConfig.width} 
                  onChange={(e) => setBoardConfig({...boardConfig, width: Number(e.target.value)})}
                  className="p-1 border rounded"
                  min="5" max="100"
                />
              </label>
              <label className="flex flex-col">
                <span className="mb-1 text-gray-600">縦穴数</span>
                <input 
                  type="number" 
                  value={boardConfig.height} 
                  onChange={(e) => setBoardConfig({...boardConfig, height: Number(e.target.value)})}
                  className="p-1 border rounded"
                  min="5" max="100"
                />
              </label>
              <label className="flex flex-col col-span-2">
                <span className="mb-1 text-gray-600">ピッチ (mm)</span>
                <input 
                  type="number" 
                  value={boardConfig.pitch} 
                  onChange={(e) => {
                    const p = Math.max(0.1, Number(e.target.value));
                    setBoardConfig({
                      ...boardConfig, 
                      pitch: p,
                      gridSize: p * PIXELS_PER_MM
                    });
                  }}
                  className="p-1 border rounded"
                  step="0.01"
                  min="0.1"
                  max="10"
                />
              </label>
            </div>
          </div>

          {/* 表示設定 */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Type size={12} /> 表示設定
            </h3>
            <button 
              onClick={() => setShowLabels(!showLabels)}
              className="flex items-center gap-2 text-sm p-2 hover:bg-gray-50 rounded w-full"
            >
              {showLabels ? <ToggleRight className="text-indigo-600" /> : <ToggleLeft className="text-gray-400" />}
              部品ラベルを表示
            </button>
          </div>

          {/* 基本ツール */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">ツール</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => selectTool('select')}
                className={`flex items-center gap-2 p-2 rounded text-sm ${selectedTool === 'select' ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-500' : 'hover:bg-gray-100'}`}
              >
                <MousePointer2 size={16} /> 選択・移動
              </button>
              <button
                onClick={() => selectTool('wire')}
                className={`flex items-center gap-2 p-2 rounded text-sm ${selectedTool === 'wire' ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-500' : 'hover:bg-gray-100'}`}
              >
                <Activity size={16} /> 配線モード
              </button>
            </div>
          </div>

          {/* 選択部品の属性編集（最優先） */}
          {currentSelectedComponent && (
            <div className="bg-indigo-50 p-3 rounded border border-indigo-200 mb-2 animate-fade-in border-l-4 border-l-indigo-500">
              <h3 className="text-xs font-semibold text-indigo-700 uppercase tracking-wider mb-2 flex justify-between">
                <span>選択部品: {COMPONENT_DEFINITIONS[currentSelectedComponent.type.toUpperCase()]?.name}</span>
              </h3>
              <div className="space-y-2 text-xs">
                <label className="block">
                  <span className="text-gray-600 block mb-1">部品名 (例: R1)</span>
                  <input 
                    type="text" 
                    value={currentSelectedComponent.name || ''} 
                    onChange={e => handleAttributeChange('name', e.target.value)} 
                    className="w-full p-1 border rounded" 
                  />
                </label>
                <label className="block">
                  <span className="text-gray-600 block mb-1">説明 (例: 10kΩ)</span>
                  <input 
                    type="text" 
                    value={currentSelectedComponent.value || ''} 
                    onChange={e => handleAttributeChange('value', e.target.value)} 
                    className="w-full p-1 border rounded" 
                  />
                </label>
              </div>
            </div>
          )}

          {/* 部品サイズ設定（ツール選択中） */}
          {selectedTool !== 'select' && selectedTool !== 'wire' && (
             <div className="bg-yellow-50 p-3 rounded border border-yellow-200 mb-2 animate-fade-in">
               <h3 className="text-xs font-semibold text-yellow-700 uppercase tracking-wider mb-2 flex justify-between">
                 <span>初期サイズ設定</span>
                 <span className="text-yellow-600 normal-case font-normal text-[10px]">{COMPONENT_DEFINITIONS[selectedTool.toUpperCase()]?.name}</span>
               </h3>
               <div className="grid grid-cols-2 gap-2 text-xs">
                 <label>
                   幅（マス）: 
                   <input 
                    type="number" 
                    min="1" 
                    max="40" 
                    value={activeSize.width} 
                    onChange={e => handleSizeChange('width', e.target.value)} 
                    className="w-12 p-1 border rounded ml-1" 
                   />
                 </label>
                 <label>
                   高さ（マス）: 
                   <input 
                    type="number" 
                    min="1" 
                    max="40" 
                    value={activeSize.height} 
                    onChange={e => handleSizeChange('height', e.target.value)} 
                    className="w-12 p-1 border rounded ml-1" 
                   />
                 </label>
               </div>
             </div>
          )}

          {/* 配線色 */}
          {selectedTool === 'wire' && (
            <div className="animate-fade-in">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">配線色</h3>
              <div className="flex flex-wrap gap-2">
                {WIRE_COLORS.map(c => (
                  <button
                    key={c.name}
                    onClick={() => setWireColor(c.value)}
                    className={`w-6 h-6 rounded-full border border-gray-300 shadow-sm ${wireColor === c.value ? 'ring-2 ring-offset-1 ring-indigo-500' : ''}`}
                    style={{ backgroundColor: c.value }}
                    title={c.name}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 部品パレット */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">部品リスト</h3>
            <div className="space-y-1">
              {Object.values(COMPONENT_DEFINITIONS).map(comp => (
                <button
                  key={comp.id}
                  onClick={() => selectTool(comp.id)}
                  className={`w-full flex items-center gap-3 p-2 rounded text-sm text-left transition-colors ${selectedTool === comp.id ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-500' : 'hover:bg-gray-50'}`}
                >
                  <div className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded border border-gray-200">
                    {comp.id === 'resistor' && <Box size={14} className="text-gray-500" />}
                    {comp.id === 'led' && <Zap size={14} className="text-red-500" />}
                    {comp.id === 'ic_dip' && <Cpu size={14} className="text-gray-800" />}
                    {comp.id === 'capacitor' && <Box size={14} className="text-blue-500" />}
                    {comp.id === 'jumper' && (
                      <div className="flex gap-0.5">
                        <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full" />
                        <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span>{comp.name}</span>
                    <span className="text-[10px] text-gray-400">
                      {componentSizes[comp.id] ? `${componentSizes[comp.id].width}x${componentSizes[comp.id].height}` : `${comp.defaultWidth}x${comp.defaultHeight}`}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="p-3 bg-blue-50 rounded text-xs text-blue-700 space-y-1">
            <p><strong>Rキー:</strong> 選択部品を回転</p>
            <p><strong>Delete:</strong> 選択項目を削除</p>
            <p><strong>Esc / 右クリック:</strong> キャンセル</p>
          </div>
        </div>

        <div className="p-4 border-t border-gray-200 bg-gray-50 flex gap-2">
           <button onClick={saveDesign} className="flex-1 flex items-center justify-center gap-1 bg-white border border-gray-300 p-2 rounded hover:bg-gray-100 text-sm" title="保存">
             <Save size={16} /> 保存
           </button>
           <label className="flex-1 flex items-center justify-center gap-1 bg-white border border-gray-300 p-2 rounded hover:bg-gray-100 text-sm cursor-pointer" title="開く">
             <FolderOpen size={16} /> 開く
             <input type="file" accept=".json" onChange={loadDesign} className="hidden" />
           </label>
        </div>
      </div>

      {/* メインエリア */}
      <div className="flex-1 flex flex-col relative bg-gray-200 overflow-hidden">
        
        <div className="absolute top-4 left-4 right-4 flex justify-between pointer-events-none z-10">
          <div className="bg-white/90 backdrop-blur shadow rounded-lg p-1 flex gap-1 pointer-events-auto">
             <button onClick={() => setScale(s => Math.max(0.5, s - 0.1))} className="p-2 hover:bg-gray-100 rounded"><Minus size={16} /></button>
             <span className="p-2 text-sm font-mono min-w-[3rem] text-center">{Math.round(scale * 100)}%</span>
             <button onClick={() => setScale(s => Math.min(3, s + 0.1))} className="p-2 hover:bg-gray-100 rounded"><Plus size={16} /></button>
          </div>

          {selectedItem && (
            <div className="bg-white/90 backdrop-blur shadow rounded-lg p-1 flex gap-1 pointer-events-auto animate-fade-in">
               {selectedItem.type === 'component' && (
                 <button onClick={rotateSelected} className="p-2 hover:bg-gray-100 rounded text-blue-600" title="回転">
                   <RotateCw size={16} />
                 </button>
               )}
               <button onClick={deleteSelected} className="p-2 hover:bg-red-50 rounded text-red-600" title="削除">
                 <Trash2 size={16} />
               </button>
            </div>
          )}
        </div>

        <div 
             ref={containerRef}
             className="flex-1 overflow-auto flex items-center justify-center p-8 cursor-crosshair"
             onMouseDown={(e) => {
               if(e.target === e.currentTarget) setSelectedItem(null);
             }}
        >
          <div 
            style={{ 
              transform: `scale(${scale})`, 
              transformOrigin: 'center center',
              transition: 'transform 0.1s ease-out'
            }}
            className="bg-[#2d7a4d] shadow-2xl relative transition-all duration-300"
          >
            <svg
              ref={svgRef}
              width={boardConfig.width * boardConfig.gridSize + boardConfig.gridSize}
              height={boardConfig.height * boardConfig.gridSize + boardConfig.gridSize}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove} 
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              onContextMenu={handleRightClick}
              id="board-bg"
              className="block"
            >
              <defs>
                 <pattern id="grid" width={boardConfig.gridSize} height={boardConfig.gridSize} patternUnits="userSpaceOnUse">
                   <circle cx={boardConfig.gridSize/2} cy={boardConfig.gridSize/2} r={1} fill="#e5e7eb" opacity="0.5" />
                 </pattern>
              </defs>

              <g>{renderGridHoles()}</g>

              {selectedTool === 'wire' && hoveredGrid && (
                <g className="pointer-events-none">
                  <circle
                    cx={hoveredGrid.x * boardConfig.gridSize}
                    cy={hoveredGrid.y * boardConfig.gridSize}
                    r={boardConfig.gridSize / 2.5}
                    fill={wireColor}
                    opacity={0.3}
                  />
                  <circle
                    cx={hoveredGrid.x * boardConfig.gridSize}
                    cy={hoveredGrid.y * boardConfig.gridSize}
                    r={2}
                    fill="white"
                  />
                </g>
              )}

              <g className="wires">
                {wires.map(wire => {
                  const isSelected = selectedItem?.type === 'wire' && selectedItem.id === wire.id;
                  return (
                    <g 
                      key={wire.id} 
                      onClick={(e) => { e.stopPropagation(); setSelectedItem({ type: 'wire', id: wire.id }); }}
                      className="cursor-pointer hover:opacity-80"
                    >
                      <line 
                        x1={wire.startX * boardConfig.gridSize} y1={wire.startY * boardConfig.gridSize}
                        x2={wire.endX * boardConfig.gridSize} y2={wire.endY * boardConfig.gridSize}
                        stroke="transparent" strokeWidth={boardConfig.gridSize/2}
                      />
                      <line 
                        x1={wire.startX * boardConfig.gridSize} y1={wire.startY * boardConfig.gridSize}
                        x2={wire.endX * boardConfig.gridSize} y2={wire.endY * boardConfig.gridSize}
                        stroke={wire.color} 
                        strokeWidth={Math.max(2, boardConfig.gridSize * 0.15)} 
                        strokeLinecap="round"
                        opacity={0.9}
                      />
                      {isSelected && (
                        <line 
                          x1={wire.startX * boardConfig.gridSize} y1={wire.startY * boardConfig.gridSize}
                          x2={wire.endX * boardConfig.gridSize} y2={wire.endY * boardConfig.gridSize}
                          stroke="white" 
                          strokeWidth={1} 
                          strokeDasharray="2,2" 
                        />
                      )}
                    </g>
                  );
                })}

                {selectedTool === 'wire' && currentWireStart && hoveredGrid && (
                   <g className="pointer-events-none">
                     <line 
                      x1={currentWireStart.x * boardConfig.gridSize} 
                      y1={currentWireStart.y * boardConfig.gridSize}
                      x2={hoveredGrid.x * boardConfig.gridSize} 
                      y2={hoveredGrid.y * boardConfig.gridSize}
                      stroke={wireColor} 
                      strokeWidth={Math.max(2, boardConfig.gridSize * 0.15)} 
                      strokeLinecap="round"
                      opacity={0.6}
                      strokeDasharray="4,4"
                     />
                     <circle 
                      cx={currentWireStart.x * boardConfig.gridSize} 
                      cy={currentWireStart.y * boardConfig.gridSize}
                      r={4}
                      fill={wireColor}
                     />
                   </g>
                )}
              </g>

              <g className="components">
                {components.map(comp => {
                  const def = Object.values(COMPONENT_DEFINITIONS).find(t => t.id === comp.type);
                  const isSelected = selectedItem?.type === 'component' && selectedItem.id === comp.id;
                  
                  const offsetX = -boardConfig.gridSize / 2;
                  const offsetY = -boardConfig.gridSize / 2;
                  
                  const w = comp.width * boardConfig.gridSize;
                  const h = comp.height * boardConfig.gridSize;

                  return (
                    <g
                      key={comp.id}
                      transform={`translate(${comp.x + offsetX}, ${comp.y + offsetY}) rotate(${comp.rotation}, ${boardConfig.gridSize / 2}, ${boardConfig.gridSize / 2})`}
                      onMouseDown={(e) => handleComponentDragStart(e, comp.id)}
                      className="cursor-move"
                      style={{ filter: isSelected ? 'drop-shadow(0 0 2px white)' : 'none' }}
                    >
                      {isSelected && (
                        <rect 
                          x={-2} y={-2} 
                          width={w + 4} 
                          height={h + 4} 
                          fill="none" stroke="#6366f1" strokeWidth="1" strokeDasharray="2,2" rx="2" 
                        />
                      )}
                      
                      {def.render(w, h, boardConfig.gridSize, comp.width, comp.height)}

                      {/* ラベル表示 */}
                      {showLabels && (
                        <g transform={`rotate(${-comp.rotation}, ${w/2}, ${h/2})`}> 
                          {/* 回転をキャンセルして正立させる場合（オプション） 
                              今回は単純に部品と一緒に回転させるためそのまま描画 */}
                          <text 
                            x={w / 2} 
                            y={-5} 
                            textAnchor="middle" 
                            fontSize={boardConfig.gridSize * 0.6} 
                            fill="white"
                            className="font-bold drop-shadow-md select-none pointer-events-none"
                            style={{ textShadow: '0px 0px 2px rgba(0,0,0,0.8)' }}
                          >
                            {comp.name}
                          </text>
                          <text 
                            x={w / 2} 
                            y={h + boardConfig.gridSize * 0.6} 
                            textAnchor="middle" 
                            fontSize={boardConfig.gridSize * 0.5} 
                            fill="#ddd"
                            className="drop-shadow-md select-none pointer-events-none"
                            style={{ textShadow: '0px 0px 2px rgba(0,0,0,0.8)' }}
                          >
                            {comp.value}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>

            </svg>
            
            <div className="absolute top-1 left-1 w-2 h-2 rounded-full bg-yellow-700/50"></div>
            <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-yellow-700/50"></div>
            <div className="absolute bottom-1 left-1 w-2 h-2 rounded-full bg-yellow-700/50"></div>
            <div className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-yellow-700/50"></div>
          </div>
        </div>
        
        <div className="bg-white border-t p-2 text-xs text-gray-500 flex justify-between">
           <span>Grid: {boardConfig.width}x{boardConfig.height} (Pitch: {boardConfig.pitch}mm)</span>
           <span>Items: {components.length} components, {wires.length} wires</span>
        </div>
      </div>
    </div>
  );
}