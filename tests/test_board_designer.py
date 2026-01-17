import os
import pytest
from playwright.sync_api import Page, expect

# HTMLファイルの絶対パスを取得
BASE_DIR = os.getcwd()
HTML_FILE = os.path.join(BASE_DIR, "universal-board-designer.html")
FILE_URL = f"file://{HTML_FILE}"

@pytest.fixture(scope="function", autouse=True)
def load_page(page: Page):
    """各テストの前にページをロードする"""
    page.goto(FILE_URL)
    # SVGがレンダリングされるまで待機
    page.wait_for_selector("svg#board-svg")

def test_initial_layout(page: Page):
    """初期レイアウトとタイトルの確認"""
    expect(page).to_have_title("ユニバーサル基板図メーカー")
    
    # サイドバーの確認
    expect(page.locator("text=UniBoard Designer")).to_be_visible()
    
    # デフォルト設定値の確認
    # Width input
    width_input = page.locator("input[type='number']").nth(0)
    expect(width_input).to_have_value("40")
    
    # Height input
    height_input = page.locator("input[type='number']").nth(1)
    expect(height_input).to_have_value("30")

def test_component_placement(page: Page):
    """部品の配置テスト"""
    # 抵抗ツールを選択 (ツールボタンの最初のほうにあると想定)
    # テキストを含むボタンをクリック
    page.locator("button:has-text('抵抗')").click()
    
    # 基板上の座標 (200, 200) をクリック
    # SVG座標系でのクリックが必要だが、Playwrightは画面上のピクセルでクリックする
    # SVG要素を取得して、その中の特定位置をクリックする
    svg = page.locator("#board-svg")
    box = svg.bounding_box()
    if box:
        click_x = box['x'] + 200
        click_y = box['y'] + 200
        page.mouse.click(click_x, click_y)
    
    # 部品が追加されたか確認
    # <g class="components"> の中に子要素が増えているか
    components_group = page.locator("g.components")
    # 初期状態では空配列でレンダリングされていてもgは存在する
    # 子要素(個別の部品グループ)があるか確認
    expect(components_group.locator("g").first).to_be_visible()
    
    # ステートの確認 (White-box testing)
    state = page.evaluate("window.state")
    assert len(state['components']) == 1
    assert state['components'][0]['type'] == 'resistor'

def test_wire_drawing(page: Page):
    """配線の描画テスト"""
    # 配線モードにする
    page.locator("button:has-text('配線モード')").click()
    
    svg = page.locator("#board-svg")
    box = svg.bounding_box()
    
    if box:
        # 始点 (50, 50)
        page.mouse.click(box['x'] + 50, box['y'] + 50)
        # 終点 (150, 150)
        page.mouse.click(box['x'] + 150, box['y'] + 150)
    
    # 配線グループ内に配線(polyline)が存在するか確認
    # <g class="wires"> -> <g> -> <polyline>
    wires_group = page.locator("g.wires")
    expect(wires_group.locator("polyline").first).to_be_visible()
    
    # State確認
    wire_count = page.evaluate("state.wires.length")
    assert wire_count == 1

def test_selection_and_deletion(page: Page):
    """選択と削除のテスト"""
    # 汎用部品を配置
    page.locator("button:has-text('汎用部品')").click()
    
    svg = page.locator("#board-svg")
    box = svg.bounding_box()
    if box:
        page.mouse.click(box['x'] + 100, box['y'] + 100)
    
    # 選択モードに戻す
    page.locator("button:has-text('選択・移動')").click()
    
    # 配置した部品をクリックして選択
    # 直前のクリック位置と同じ場所
    page.mouse.click(box['x'] + 100, box['y'] + 100)
    
    # Stateで選択されているか確認
    selected_item = page.evaluate("state.selectedItem")
    assert selected_item is not None
    assert selected_item['type'] == 'component'
    
    # 削除操作 (Deleteキー)
    page.keyboard.press("Delete")
    
    # 削除されたか確認
    comp_count = page.evaluate("state.components.length")
    assert comp_count == 0

def test_wire_drag_endpoint(page: Page):
    """配線端点のドラッグ移動テスト"""
    # 配線を作成
    page.locator("button:has-text('配線モード')").click()
    svg = page.locator("#board-svg")
    box = svg.bounding_box()
    
    if box:
        start_x = box['x'] + 50
        start_y = box['y'] + 50
        end_x = box['x'] + 100
        end_y = box['y'] + 50
        
        page.mouse.click(start_x, start_y)
        page.mouse.click(end_x, end_y)
        
        # 選択モードへ
        page.locator("button:has-text('選択・移動')").click()
        
        # 配線をクリックして選択 (透明なヒットボックスがあるのでクリックしやすいはず)
        # 線の中間あたりをクリック
        mid_x = (start_x + end_x) / 2
        page.mouse.click(mid_x, start_y)
        
        # ハンドルが表示されているか確認 (class="ui-overlay"内のcircle)
        # 大きなハンドル(cursor: grab)が表示されるはず
        expect(page.locator("g.ui-overlay circle[style*='cursor: grab']").first).to_be_visible()
        
        # 始点ハンドルをつかんでドラッグ
        # 始点座標 = (start_x, start_y)
        page.mouse.move(start_x, start_y)
        page.mouse.down()
        page.mouse.move(start_x, start_y + 50) # 下に50px移動
        page.mouse.up()
        
        # Stateで座標が更新されたか確認
        # 元のY座標より大きくなっているはず
        updated_wire = page.evaluate("state.wires[0]")
        # グリッド座標なので正確な値はグリッドサイズ計算が必要だが、変更されていることを確認
        assert updated_wire['startY'] > updated_wire['endY'] # 元は同じ高さだったが、始点を下に下げたので

def test_view_switching(page: Page):
    """表裏表示切り替えテスト"""
    # 「基板の裏面を見る」ボタン (のようなトグルがあるか確認)
    # 実装では toggle button
    
    # ステートを直接操作して確認
    page.evaluate("state.viewSide = 'back'; render();")
    
    # #board-svg > g の transform 属性を確認
    main_group = page.locator("#board-svg > g").first
    transform_attr = main_group.get_attribute("transform")
    
    assert "scale(-1, 1)" in transform_attr
