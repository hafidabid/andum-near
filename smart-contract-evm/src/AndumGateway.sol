// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

interface IMockToken {
    function burnFrom(address account, uint256 amount) external;
    function mint(address to, uint256 amount) external;
}

/// @notice DEMO bridge gateway (ANDUM-PLAN section 6.2). The relayer is trusted. Production path: NEAR Intents.
contract AndumGateway is ERC2771Context, Ownable2Step, Pausable, ReentrancyGuard {
    struct Asset { address token; bool enabled; uint256 maxPerTx; }

    mapping(bytes32 => Asset) public assets;
    mapping(address => bool) public relayers;
    mapping(uint256 => bool) public processedNearNonce;
    uint256 public outNonce;

    event DepositedForNear(
        uint256 indexed nonce, bytes32 indexed assetId, address indexed from, uint256 amount,
        string nearAccount, uint64 packageId, uint8 partId, bool fund
    );
    event Released(uint256 indexed nearNonce, bytes32 indexed assetId, address indexed to, uint256 amount, string nearTxHash);
    event AssetSet(bytes32 indexed assetId, address token, bool enabled, uint256 maxPerTx);
    event RelayerSet(address indexed relayer, bool allowed);

    error AssetDisabled();
    error BadAmount();
    error BadNearAccount();
    error NotRelayer();
    error AlreadyReleased();
    error ZeroAddress();

    constructor(address trustedForwarder, address owner_) ERC2771Context(trustedForwarder) Ownable(owner_) {}

    // ------------------------------------------------------------------ user
    function depositForNear(
        bytes32 assetId, uint256 amount, string calldata nearAccount, uint64 packageId, uint8 partId, bool fund
    ) external whenNotPaused nonReentrant {
        _deposit(assetId, amount, nearAccount, packageId, partId, fund);
    }

    function depositForNearWithPermit(
        bytes32 assetId, uint256 amount, string calldata nearAccount, uint64 packageId, uint8 partId, bool fund,
        uint256 deadline, uint8 v, bytes32 r, bytes32 s
    ) external whenNotPaused nonReentrant {
        Asset memory a = assets[assetId];
        if (!a.enabled) revert AssetDisabled();
        // a front-run permit must not block the deposit: ignore failure, burnFrom checks the allowance
        try IERC20Permit(a.token).permit(_msgSender(), address(this), amount, deadline, v, r, s) {} catch {}
        _deposit(assetId, amount, nearAccount, packageId, partId, fund);
    }

    function _deposit(
        bytes32 assetId, uint256 amount, string calldata nearAccount, uint64 packageId, uint8 partId, bool fund
    ) internal {
        Asset memory a = assets[assetId];
        if (!a.enabled) revert AssetDisabled();
        if (amount == 0 || amount > a.maxPerTx) revert BadAmount();
        uint256 len = bytes(nearAccount).length;
        if (len == 0 || len > 64) revert BadNearAccount();
        address from = _msgSender();
        IMockToken(a.token).burnFrom(from, amount);
        uint256 nonce = ++outNonce;
        emit DepositedForNear(nonce, assetId, from, amount, nearAccount, packageId, partId, fund);
    }

    // ------------------------------------------------------------------ relayer
    function release(bytes32 assetId, address to, uint256 amount, uint256 nearNonce, string calldata nearTxHash)
        external whenNotPaused nonReentrant
    {
        if (!relayers[_msgSender()]) revert NotRelayer();
        Asset memory a = assets[assetId];
        if (!a.enabled) revert AssetDisabled();
        if (to == address(0) || amount == 0) revert BadAmount();
        if (processedNearNonce[nearNonce]) revert AlreadyReleased();
        processedNearNonce[nearNonce] = true;
        IMockToken(a.token).mint(to, amount);
        emit Released(nearNonce, assetId, to, amount, nearTxHash);
    }

    // ------------------------------------------------------------------ admin
    function setAsset(bytes32 assetId, address token, bool enabled, uint256 maxPerTx) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        assets[assetId] = Asset(token, enabled, maxPerTx);
        emit AssetSet(assetId, token, enabled, maxPerTx);
    }

    function setRelayer(address relayer, bool allowed) external onlyOwner {
        relayers[relayer] = allowed;
        emit RelayerSet(relayer, allowed);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ------------------------------------------------------------------ ERC-2771 plumbing
    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }
    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }
    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}
