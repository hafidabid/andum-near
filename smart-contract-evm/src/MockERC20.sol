// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Valueless demo token with a capped public faucet (ANDUM-PLAN section 6.1).
contract MockERC20 is ERC20, ERC20Burnable, ERC20Permit, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 public constant WINDOW = 1 days;

    uint8 private immutable _decimals;
    uint256 public immutable faucetPerCall;
    uint256 public immutable faucetDaily;

    struct Window { uint64 start; uint192 used; }
    mapping(address => Window) public faucetWindow;

    error FaucetCapPerCall();
    error FaucetCapDaily();
    error ZeroAmount();
    error ZeroAddress();

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 faucetPerCall_,
        uint256 faucetDaily_,
        address admin
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        if (admin == address(0)) revert ZeroAddress();
        require(faucetPerCall_ <= faucetDaily_, "caps");
        _decimals = decimals_;
        faucetPerCall = faucetPerCall_;
        faucetDaily = faucetDaily_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Open faucet. `amount <= faucetPerCall`, and at most `faucetDaily` per recipient per 24 h window.
    function faucet(address to, uint256 amount) external {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > faucetPerCall) revert FaucetCapPerCall();
        Window memory w = faucetWindow[to];
        if (w.start == 0 || block.timestamp >= uint256(w.start) + WINDOW) {
            w = Window({start: uint64(block.timestamp), used: 0});
        }
        if (uint256(w.used) + amount > faucetDaily) revert FaucetCapDaily();
        w.used += uint192(amount);
        faucetWindow[to] = w;
        _mint(to, amount);
    }

    function faucetRemaining(address to) external view returns (uint256) {
        Window memory w = faucetWindow[to];
        if (w.start == 0 || block.timestamp >= uint256(w.start) + WINDOW) return faucetDaily;
        return faucetDaily - w.used;
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }
}
